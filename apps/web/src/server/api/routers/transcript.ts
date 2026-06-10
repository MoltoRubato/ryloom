import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { transcriptSegments, transcripts, videos } from "@ryloom/db";

import { resolveVideoAccess } from "@/server/api/routers/_video-access";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** HH:MM:SS.mmm (VTT) or HH:MM:SS,mmm (SRT). */
function formatTimestamp(ms: number, msSeparator: "." | ","): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${msSeparator}${pad(millis, 3)}`;
}

async function getOwnedVideoForTranscript(
  ctx: TRPCContext & { user: NonNullable<TRPCContext["user"]> },
  videoId: string,
): Promise<typeof videos.$inferSelect> {
  const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video || video.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }
  if (video.ownerId !== ctx.user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the video owner can edit its transcript",
    });
  }
  return video;
}

async function getLatestTranscript(ctx: TRPCContext, videoId: string) {
  return ctx.db.query.transcripts.findFirst({
    where: eq(transcripts.videoId, videoId),
    orderBy: desc(transcripts.createdAt),
  });
}

async function getOrderedSegments(ctx: TRPCContext, transcriptId: string) {
  return ctx.db.query.transcriptSegments.findMany({
    where: eq(transcriptSegments.transcriptId, transcriptId),
    orderBy: [asc(transcriptSegments.idx), asc(transcriptSegments.startMs)],
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const transcriptRouter = createTRPCRouter({
  /** Transcript + ordered segments; share-token access respects allowTranscript. */
  get: publicProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        shareToken: z.string().min(6).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await resolveVideoAccess(ctx, {
        videoId: input.videoId,
        token: input.shareToken,
      });
      if (!access.allow.allowTranscript && !access.isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The transcript isn't available for this video",
        });
      }

      const transcript = await getLatestTranscript(ctx, access.video.id);
      if (!transcript) {
        return { transcript: null, segments: [] };
      }
      const segments = await getOrderedSegments(ctx, transcript.id);
      return { transcript, segments };
    }),

  /** Edits a segment and regenerates the transcript's fullText. Owner only. */
  updateSegment: protectedProcedure
    .input(z.object({ segmentId: z.string().uuid(), text: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const segment = await ctx.db.query.transcriptSegments.findFirst({
        where: eq(transcriptSegments.id, input.segmentId),
      });
      if (!segment) throw new TRPCError({ code: "NOT_FOUND", message: "Segment not found" });
      const transcript = await ctx.db.query.transcripts.findFirst({
        where: eq(transcripts.id, segment.transcriptId),
      });
      if (!transcript) throw new TRPCError({ code: "NOT_FOUND", message: "Transcript not found" });
      await getOwnedVideoForTranscript(ctx, transcript.videoId);

      const [updated] = await ctx.db
        .update(transcriptSegments)
        .set({ text: input.text })
        .where(eq(transcriptSegments.id, segment.id))
        .returning();

      const all = await getOrderedSegments(ctx, transcript.id);
      const fullText = all
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ");
      await ctx.db
        .update(transcripts)
        .set({ fullText, editedByUser: true, updatedAt: new Date() })
        .where(eq(transcripts.id, transcript.id));

      return updated;
    }),

  /** Builds a VTT/SRT/TXT export string from the segments. Owner only. */
  export: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        format: z.enum(["vtt", "srt", "txt"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const video = await getOwnedVideoForTranscript(ctx, input.videoId);
      const transcript = await getLatestTranscript(ctx, video.id);
      if (!transcript) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No transcript exists for this video yet",
        });
      }
      const segments = await getOrderedSegments(ctx, transcript.id);

      switch (input.format) {
        case "txt": {
          if (segments.length === 0) return transcript.fullText ?? "";
          return segments
            .map((s) => s.text.trim())
            .filter(Boolean)
            .join("\n");
        }
        case "vtt": {
          const cues = segments.map(
            (s, i) =>
              `${i + 1}\n${formatTimestamp(s.startMs, ".")} --> ${formatTimestamp(s.endMs, ".")}\n${s.text.trim()}`,
          );
          return `WEBVTT\n\n${cues.join("\n\n")}\n`;
        }
        case "srt": {
          const cues = segments.map(
            (s, i) =>
              `${i + 1}\n${formatTimestamp(s.startMs, ",")} --> ${formatTimestamp(s.endMs, ",")}\n${s.text.trim()}`,
          );
          return `${cues.join("\n\n")}\n`;
        }
      }
    }),
});
