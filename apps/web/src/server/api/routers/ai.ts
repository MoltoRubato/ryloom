import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { aiOutputs, processingJobs, transcripts, videos, workspaceUsage } from "@ryloom/db";

import {
  ADMIN_ROLES,
  createTRPCRouter,
  protectedProcedure,
  requireMembership,
  requirePlanFeature,
  type Membership,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const AI_OUTPUT_TYPES = [
  "title",
  "summary",
  "long_summary",
  "chapters",
  "action_items",
  "bug_report",
  "sop",
  "email_draft",
  "slack_message",
  "pr_description",
  "jira_issue",
  "linear_issue",
  "faq",
  "meeting_notes",
  "recap_email",
  "doc",
] as const;

/** Document workflows (video-to-doc/ticket/email) — gated behind aiWorkflows. */
const DOC_TYPES = new Set<(typeof AI_OUTPUT_TYPES)[number]>([
  "bug_report",
  "sop",
  "email_draft",
  "slack_message",
  "pr_description",
  "jira_issue",
  "linear_issue",
  "faq",
  "meeting_notes",
  "recap_email",
  "doc",
]);

async function getOwnedVideo(
  ctx: TRPCContext & { user: NonNullable<TRPCContext["user"]> },
  videoId: string,
): Promise<{ video: typeof videos.$inferSelect; membership: Membership }> {
  const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video || video.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }
  const membership = await requireMembership(ctx, video.workspaceId);
  const isOwner = video.ownerId === ctx.user.id;
  const isAdmin = ADMIN_ROLES.includes(membership.role) || membership.role === "content_admin";
  if (!isOwner && !isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't manage this video" });
  }
  return { video, membership };
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

const chapterSchema = z.object({
  title: z.string().min(1).max(200),
  startMs: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const aiRouter = createTRPCRouter({
  generate: protectedProcedure
    .input(z.object({ videoId: z.string().uuid(), type: z.enum(AI_OUTPUT_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);

      if (DOC_TYPES.has(input.type)) {
        requirePlanFeature(membership, "aiWorkflows", "AI workflows");
      }

      // Monthly cap (null = unlimited).
      const cap = membership.plan.aiGenerationsPerMonth;
      const period = currentPeriod();
      if (cap !== null) {
        if (cap === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `AI generations aren't included in the ${membership.plan.name} plan. Upgrade to unlock AI features.`,
          });
        }
        const usage = await ctx.db.query.workspaceUsage.findFirst({
          where: and(
            eq(workspaceUsage.workspaceId, video.workspaceId),
            eq(workspaceUsage.period, period),
          ),
        });
        if ((usage?.aiGenerations ?? 0) >= cap) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You've used all ${cap} AI generations included in the ${membership.plan.name} plan this month. Upgrade for more.`,
          });
        }
      }

      const transcript = await ctx.db.query.transcripts.findFirst({
        where: and(eq(transcripts.videoId, video.id), eq(transcripts.status, "ready")),
      });
      if (!transcript) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Transcript isn't ready yet" });
      }

      // Upsert: regenerating a type resets the existing row to pending and
      // clears prior content so the UI shows a fresh loading state.
      const existing = await ctx.db.query.aiOutputs.findFirst({
        where: and(eq(aiOutputs.videoId, video.id), eq(aiOutputs.type, input.type)),
      });
      let output: typeof aiOutputs.$inferSelect | undefined;
      if (existing) {
        [output] = await ctx.db
          .update(aiOutputs)
          .set({
            status: "pending",
            contentText: null,
            contentJson: null,
            errorMessage: null,
            editedByUser: false,
            requestedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(aiOutputs.id, existing.id))
          .returning();
      } else {
        [output] = await ctx.db
          .insert(aiOutputs)
          .values({
            videoId: video.id,
            type: input.type,
            status: "pending",
            requestedBy: ctx.user.id,
          })
          .returning();
      }
      if (!output) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await ctx.db.insert(processingJobs).values({
        videoId: video.id,
        workspaceId: video.workspaceId,
        type: "ai_generate",
        priority: membership.plan.priorityProcessing ? 10 : 0,
        inputJson: { aiOutputId: output.id, outputType: input.type },
      });

      await ctx.db
        .insert(workspaceUsage)
        .values({ workspaceId: video.workspaceId, period, aiGenerations: 1 })
        .onConflictDoUpdate({
          target: [workspaceUsage.workspaceId, workspaceUsage.period],
          set: {
            aiGenerations: sql`${workspaceUsage.aiGenerations} + 1`,
            updatedAt: new Date(),
          },
        });

      return output;
    }),

  list: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { video } = await getOwnedVideo(ctx, input.videoId);
      return ctx.db.query.aiOutputs.findMany({
        where: eq(aiOutputs.videoId, video.id),
        orderBy: desc(aiOutputs.updatedAt),
      });
    }),

  get: protectedProcedure
    .input(z.object({ videoId: z.string().uuid(), type: z.enum(AI_OUTPUT_TYPES) }))
    .query(async ({ ctx, input }) => {
      const { video } = await getOwnedVideo(ctx, input.videoId);
      const output = await ctx.db.query.aiOutputs.findFirst({
        where: and(eq(aiOutputs.videoId, video.id), eq(aiOutputs.type, input.type)),
      });
      return output ?? null;
    }),

  updateContent: protectedProcedure
    .input(
      z
        .object({
          aiOutputId: z.string().uuid(),
          contentText: z.string().max(100_000).optional(),
          contentJson: z.record(z.unknown()).optional(),
        })
        .refine((v) => v.contentText !== undefined || v.contentJson !== undefined, {
          message: "contentText or contentJson is required",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const output = await ctx.db.query.aiOutputs.findFirst({
        where: eq(aiOutputs.id, input.aiOutputId),
      });
      if (!output) throw new TRPCError({ code: "NOT_FOUND", message: "AI output not found" });
      await getOwnedVideo(ctx, output.videoId);

      const [updated] = await ctx.db
        .update(aiOutputs)
        .set({
          contentText: input.contentText !== undefined ? input.contentText : output.contentText,
          contentJson: input.contentJson !== undefined ? input.contentJson : output.contentJson,
          editedByUser: true,
          updatedAt: new Date(),
        })
        .where(eq(aiOutputs.id, output.id))
        .returning();
      return updated;
    }),

  applyChaptersToVideo: protectedProcedure
    .input(z.object({ aiOutputId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const output = await ctx.db.query.aiOutputs.findFirst({
        where: eq(aiOutputs.id, input.aiOutputId),
      });
      if (!output) throw new TRPCError({ code: "NOT_FOUND", message: "AI output not found" });
      const { video } = await getOwnedVideo(ctx, output.videoId);

      const parsed = z
        .object({ chapters: z.array(chapterSchema).min(1).max(100) })
        .safeParse(output.contentJson ?? {});
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This output doesn't contain valid chapters",
        });
      }

      const chapters = [...parsed.data.chapters].sort((a, b) => a.startMs - b.startMs);
      await ctx.db
        .update(videos)
        .set({ chapters, updatedAt: new Date() })
        .where(eq(videos.id, video.id));

      return { ok: true, chapters };
    }),
});
