import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { processingJobs, recordingSessions, videos } from "@ryloom/db";

import { env } from "@/env";
import { BUCKETS, storagePaths } from "@/lib/storage";
import {
  CREATOR_ROLES,
  createTRPCRouter,
  protectedProcedure,
  requireMembership,
} from "@/server/api/trpc";

const MIME_EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/x-matroska": "mkv",
  "audio/webm": "weba",
};

export const recordingRouter = createTRPCRouter({
  /**
   * Creates a video shell + recording session and returns everything the
   * browser needs to upload directly to Supabase Storage with TUS:
   *   tusEndpoint = `${SUPABASE_URL}/storage/v1/upload/resumable`
   *   metadata    = { bucketName, objectName, contentType }
   *   headers     = { authorization: `Bearer <user access token>` } (client-side)
   * Storage RLS allows workspace members to write to their workspace prefix.
   */
  createSession: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        mode: z.enum(["screen", "camera", "screen_camera", "audio"]).default("screen"),
        title: z.string().max(300).optional(),
        mimeType: z.string().max(100).default("video/webm"),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        sourceUrl: z.string().url().optional(),
        folderId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, CREATOR_ROLES);
      const plan = membership.plan;

      // Plan limit: max stored videos
      if (plan.maxVideos !== null) {
        const [row] = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(videos)
          .where(
            and(
              eq(videos.workspaceId, input.workspaceId),
              inArray(videos.status, ["draft", "uploading", "processing", "ready", "archived"]),
            ),
          );
        if (Number(row?.count ?? 0) >= plan.maxVideos) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Your ${plan.name} plan is limited to ${plan.maxVideos} videos. Upgrade for unlimited videos.`,
          });
        }
      }

      const defaultTitle =
        input.title ??
        `Recording — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

      const [video] = await ctx.db
        .insert(videos)
        .values({
          workspaceId: input.workspaceId,
          ownerId: ctx.user.id,
          folderId: input.folderId ?? null,
          title: defaultTitle,
          status: "uploading",
          privacy: membership.workspace.defaultPrivacy,
          allowDownload: !membership.workspace.disableDownloadsDefault,
          requireViewerIdentity: membership.workspace.requireViewerIdentity,
          watermarkViewerEmail: membership.workspace.watermarkViewerEmail,
          sourceUrl: input.sourceUrl,
          width: input.width,
          height: input.height,
        })
        .returning();
      if (!video) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const ext = MIME_EXT[input.mimeType.split(";")[0] ?? ""] ?? "webm";
      const uploadPath = storagePaths.rawRecording(input.workspaceId, video.id, ext);

      const [session] = await ctx.db
        .insert(recordingSessions)
        .values({
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          videoId: video.id,
          mode: input.mode,
          status: "recording",
          uploadBucket: BUCKETS.raw,
          uploadPath,
          mimeType: input.mimeType,
          metadata: { sourceUrl: input.sourceUrl ?? null },
        })
        .returning();
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return {
        sessionId: session.id,
        videoId: video.id,
        shareToken: video.shareToken,
        bucket: BUCKETS.raw,
        uploadPath,
        tusEndpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        limits: {
          maxRecordingMinutes: plan.maxRecordingMinutes,
          maxResolution: plan.maxResolution,
        },
      };
    }),

  /** Marks the upload finished and enqueues the processing pipeline. */
  completeSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        durationMs: z.number().int().positive().optional(),
        sizeBytes: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recording session not found" });
      }
      if (session.status === "completed") {
        return { videoId: session.videoId };
      }
      const membership = await requireMembership(ctx, session.workspaceId);
      const plan = membership.plan;

      // Plan limit: recording length (30s grace for stop latency)
      if (
        plan.maxRecordingMinutes !== null &&
        input.durationMs &&
        input.durationMs > (plan.maxRecordingMinutes * 60 + 30) * 1000
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your ${plan.name} plan allows recordings up to ${plan.maxRecordingMinutes} minutes.`,
        });
      }

      await ctx.db
        .update(recordingSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          durationMs: input.durationMs,
          sizeBytes: input.sizeBytes,
        })
        .where(eq(recordingSessions.id, session.id));

      if (session.videoId) {
        await ctx.db
          .update(videos)
          .set({
            status: "processing",
            durationMs: input.durationMs,
            sizeBytes: input.sizeBytes,
            width: input.width,
            height: input.height,
            originalFilePath: session.uploadPath,
            updatedAt: new Date(),
          })
          .where(eq(videos.id, session.videoId));

        // One pipeline job — the worker probes, transcodes, generates thumbs,
        // waveform and HLS, then chains transcription + AI jobs itself.
        await ctx.db.insert(processingJobs).values({
          videoId: session.videoId,
          workspaceId: session.workspaceId,
          type: "transcode",
          priority: plan.priorityProcessing ? 10 : 0,
          inputJson: {
            sourceBucket: session.uploadBucket,
            sourcePath: session.uploadPath,
            mimeType: session.mimeType,
            maxHeight: plan.maxResolution,
            hls: plan.hlsStreaming,
            transcribe: (plan.transcriptionMinutesPerMonth ?? 1) !== 0,
            autoAi: plan.aiGenerationsPerMonth === null || (plan.aiGenerationsPerMonth ?? 0) > 0,
          },
        });
      }

      return { videoId: session.videoId };
    }),

  cancelSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(recordingSessions)
        .set({ status: "canceled" })
        .where(eq(recordingSessions.id, session.id));
      if (session.videoId) {
        await ctx.db
          .update(videos)
          .set({ status: "deleted", deletedAt: new Date() })
          .where(eq(videos.id, session.videoId));
      }
      return { ok: true };
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return session;
    }),
});
