import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { processingJobs, recordingSessions, videos } from "@ryloom/db";

import {
  r2AbortMultipartUpload,
  r2CompleteMultipartUpload,
  r2CreateMultipartUpload,
  r2SignUploadPartUrl,
} from "@/lib/r2";
import { BUCKETS, storagePaths } from "@/lib/storage";
import { wakeWorker } from "@/lib/wake-worker";
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

/** Multipart upload tuning: 32MB parts → 20GB cap is 640 parts (R2 max 10k). */
const UPLOAD_PART_SIZE = 32 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 60 * 60 * 6;

export const recordingRouter = createTRPCRouter({
  /**
   * Creates a video shell + recording session. The actual upload happens
   * later via startUpload → presigned R2 multipart PUTs → completeUpload;
   * session ownership (not storage RLS) authorizes the object key.
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
        limits: {
          maxRecordingMinutes: plan.maxRecordingMinutes,
          maxResolution: plan.maxResolution,
        },
      };
    }),

  /**
   * Opens an R2 multipart upload for the session's raw recording and returns
   * presigned part URLs. Ownership replaces the old storage-RLS check: only
   * the session's creator can obtain upload URLs for its object key.
   */
  startUpload: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recording session not found" });
      }
      if (session.status === "completed" || session.status === "canceled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This recording session is no longer accepting uploads.",
        });
      }

      const partCount = Math.max(1, Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE));
      const uploadId = await r2CreateMultipartUpload(
        session.uploadPath,
        session.mimeType ?? "video/webm",
      );
      const urls = await Promise.all(
        Array.from({ length: partCount }, (_, i) =>
          r2SignUploadPartUrl(session.uploadPath, uploadId, i + 1, UPLOAD_URL_TTL_SECONDS),
        ),
      );
      return { uploadId, partSize: UPLOAD_PART_SIZE, urls };
    }),

  /** Finishes the R2 multipart upload (server-side, with the parts' ETags). */
  completeUpload: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        uploadId: z.string().min(1).max(2000),
        parts: z
          .array(
            z.object({
              partNumber: z.number().int().min(1).max(10000),
              // R2 part ETags are hex (md5), optionally quoted / -suffixed.
              // Strict shape keeps client input out of the signed S3 XML.
              etag: z.string().regex(/^"?[A-Fa-f0-9]{16,64}(-\d{1,5})?"?$/),
            }),
          )
          .min(1)
          .max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recording session not found" });
      }
      await r2CompleteMultipartUpload(session.uploadPath, input.uploadId, input.parts);
      return { ok: true };
    }),

  /** Best-effort abort of an in-flight multipart upload (user hit cancel). */
  abortUpload: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid(), uploadId: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, input.sessionId),
      });
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recording session not found" });
      }
      await r2AbortMultipartUpload(session.uploadPath, input.uploadId).catch(() => undefined);
      return { ok: true };
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
        wakeWorker();
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
