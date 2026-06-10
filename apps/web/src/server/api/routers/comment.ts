import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { comments, notifications, profiles, videos } from "@ryloom/db";

import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { resolveVideoAccess } from "@/server/api/routers/_video-access";
import {
  createTRPCRouter,
  getOrCreateProfile,
  protectedProcedure,
  publicProcedure,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const shareTokenInput = z.string().min(6).max(64).optional();

/** Public-safe comment columns — guest emails are never exposed to viewers. */
const publicCommentColumns = {
  id: comments.id,
  videoId: comments.videoId,
  authorId: comments.authorId,
  guestName: comments.guestName,
  parentCommentId: comments.parentCommentId,
  timestampMs: comments.timestampMs,
  body: comments.body,
  status: comments.status,
  resolvedBy: comments.resolvedBy,
  resolvedAt: comments.resolvedAt,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getManageableComment(
  ctx: TRPCContext & { user: NonNullable<TRPCContext["user"]> },
  commentId: string,
): Promise<{
  comment: typeof comments.$inferSelect;
  video: typeof videos.$inferSelect;
  isAuthor: boolean;
  isVideoOwner: boolean;
}> {
  const comment = await ctx.db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment || comment.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
  }
  const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, comment.videoId) });
  if (!video || video.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }
  const isAuthor = comment.authorId === ctx.user.id;
  const isVideoOwner = video.ownerId === ctx.user.id;
  if (!isAuthor && !isVideoOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't manage this comment" });
  }
  return { comment, video, isAuthor, isVideoOwner };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const commentRouter = createTRPCRouter({
  /** Threaded comments (top-level with replies) joined with author profiles. */
  list: publicProcedure
    .input(z.object({ videoId: z.string().uuid(), shareToken: shareTokenInput }))
    .query(async ({ ctx, input }) => {
      const access = await resolveVideoAccess(ctx, {
        videoId: input.videoId,
        token: input.shareToken,
      });
      if (input.shareToken && !access.allow.allowComments && !access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Comments are disabled for this video" });
      }

      const rows = await ctx.db
        .select({
          comment: publicCommentColumns,
          author: {
            id: profiles.id,
            name: profiles.name,
            avatarUrl: profiles.avatarUrl,
            email: profiles.email,
          },
        })
        .from(comments)
        .leftJoin(profiles, eq(comments.authorId, profiles.id))
        .where(and(eq(comments.videoId, access.video.id), ne(comments.status, "deleted")))
        .orderBy(asc(comments.createdAt));

      type Row = (typeof rows)[number];
      type Thread = Row & { replies: Row[] };

      const threads = new Map<string, Thread>();
      const topLevel: Thread[] = [];
      for (const row of rows) {
        if (row.comment.parentCommentId) continue;
        const thread: Thread = { ...row, replies: [] };
        threads.set(row.comment.id, thread);
        topLevel.push(thread);
      }
      for (const row of rows) {
        const parentId = row.comment.parentCommentId;
        if (!parentId) continue;
        const parent = threads.get(parentId);
        if (parent) {
          parent.replies.push(row);
        } else {
          // Parent was deleted — surface the orphaned reply as its own thread.
          const thread: Thread = { ...row, replies: [] };
          threads.set(row.comment.id, thread);
          topLevel.push(thread);
        }
      }
      topLevel.sort(
        (a, b) => a.comment.createdAt.getTime() - b.comment.createdAt.getTime(),
      );
      return topLevel;
    }),

  create: publicProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        shareToken: shareTokenInput,
        body: z.string().min(1).max(5000),
        timestampMs: z.number().int().nonnegative().optional(),
        parentCommentId: z.string().uuid().optional(),
        guestName: z.string().min(1).max(80).optional(),
        guestEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveVideoAccess(ctx, {
        videoId: input.videoId,
        token: input.shareToken,
      });
      const { video } = access;
      if (!access.allow.allowComments && !access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Comments are disabled for this video" });
      }
      if (!ctx.user) {
        // Guests must arrive through an allowing share link and identify themselves.
        if (!input.shareToken) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (!input.guestName?.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Please add your name to comment" });
        }
      }

      // Replies always attach to the top-level comment of their thread.
      let parentComment: typeof comments.$inferSelect | null = null;
      let parentId: string | null = null;
      if (input.parentCommentId) {
        parentComment =
          (await ctx.db.query.comments.findFirst({
            where: eq(comments.id, input.parentCommentId),
          })) ?? null;
        if (
          !parentComment ||
          parentComment.videoId !== video.id ||
          parentComment.status === "deleted"
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Comment not found" });
        }
        parentId = parentComment.parentCommentId ?? parentComment.id;
      }

      const [created] = await ctx.db
        .insert(comments)
        .values({
          videoId: video.id,
          authorId: ctx.user?.id ?? null,
          guestName: ctx.user ? null : (input.guestName?.trim() ?? null),
          guestEmail: ctx.user ? null : (input.guestEmail?.toLowerCase() ?? null),
          parentCommentId: parentId,
          timestampMs: input.timestampMs,
          body: input.body,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await ctx.db
        .update(videos)
        .set({ commentCount: sql`${videos.commentCount} + 1` })
        .where(eq(videos.id, video.id));

      const actorId = ctx.user?.id ?? null;
      let actorName = input.guestName?.trim() ?? "Someone";
      if (ctx.user) {
        const profile = await getOrCreateProfile({ db: ctx.db, user: ctx.user });
        actorName = profile.name ?? profile.email;
      }
      const excerpt = input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body;

      // In-app notifications — never to the actor themself, never twice.
      const notified = new Set<string>();
      if (actorId) notified.add(actorId);
      if (parentComment?.authorId && !notified.has(parentComment.authorId)) {
        notified.add(parentComment.authorId);
        await ctx.db.insert(notifications).values({
          userId: parentComment.authorId,
          type: "reply",
          actorId,
          workspaceId: video.workspaceId,
          videoId: video.id,
          commentId: created.id,
          title: `${actorName} replied to your comment`,
          body: excerpt,
        });
      }
      if (!notified.has(video.ownerId)) {
        notified.add(video.ownerId);
        await ctx.db.insert(notifications).values({
          userId: video.ownerId,
          type: "comment",
          actorId,
          workspaceId: video.workspaceId,
          videoId: video.id,
          commentId: created.id,
          title: `${actorName} commented on "${video.title}"`,
          body: excerpt,
        });
      }

      // Email to the video owner — best-effort, never blocks the mutation.
      if (video.ownerId !== actorId) {
        try {
          const owner = await ctx.db.query.profiles.findFirst({
            where: eq(profiles.id, video.ownerId),
            columns: { email: true },
          });
          if (owner) {
            await sendEmail({
              to: owner.email,
              subject: `New comment on "${video.title}"`,
              html: `<p><strong>${escapeHtml(actorName)}</strong> commented on <strong>${escapeHtml(video.title)}</strong>:</p><blockquote>${escapeHtml(excerpt)}</blockquote><p><a href="${env.NEXT_PUBLIC_APP_URL}/app/video/${video.id}">View the comment</a></p>`,
            });
          }
        } catch (error) {
          console.error("[comment email failed]", error);
        }
      }

      return created;
    }),

  update: protectedProcedure
    .input(z.object({ commentId: z.string().uuid(), body: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { comment } = await getManageableComment(ctx, input.commentId);
      const [updated] = await ctx.db
        .update(comments)
        .set({ body: input.body, updatedAt: new Date() })
        .where(eq(comments.id, comment.id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { comment, video } = await getManageableComment(ctx, input.commentId);
      await ctx.db
        .update(comments)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(comments.id, comment.id));
      await ctx.db
        .update(videos)
        .set({ commentCount: sql`greatest(${videos.commentCount} - 1, 0)` })
        .where(eq(videos.id, video.id));
      return { ok: true };
    }),

  resolve: protectedProcedure
    .input(z.object({ commentId: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { comment } = await getManageableComment(ctx, input.commentId);
      const [updated] = await ctx.db
        .update(comments)
        .set(
          input.resolved
            ? {
                status: "resolved",
                resolvedBy: ctx.user.id,
                resolvedAt: new Date(),
                updatedAt: new Date(),
              }
            : { status: "open", resolvedBy: null, resolvedAt: null, updatedAt: new Date() },
        )
        .where(eq(comments.id, comment.id))
        .returning();
      return updated;
    }),
});
