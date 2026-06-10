import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { profiles, reactions, videos } from "@ryloom/db";

import { resolveVideoAccess } from "@/server/api/routers/_video-access";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

const shareTokenInput = z.string().min(6).max(64).optional();
const anonymousIdInput = z.string().min(6).max(64).optional();

export const reactionRouter = createTRPCRouter({
  /**
   * Reactions for a video with reactor info. Anonymous ids are deliberately
   * not returned — exposing them would let any viewer remove someone else's
   * anonymous reaction via `remove`.
   */
  list: publicProcedure
    .input(z.object({ videoId: z.string().uuid(), shareToken: shareTokenInput }))
    .query(async ({ ctx, input }) => {
      const access = await resolveVideoAccess(ctx, {
        videoId: input.videoId,
        token: input.shareToken,
      });
      if (input.shareToken && !access.allow.allowReactions && !access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Reactions are disabled for this video" });
      }
      return ctx.db
        .select({
          id: reactions.id,
          videoId: reactions.videoId,
          emoji: reactions.emoji,
          timestampMs: reactions.timestampMs,
          userId: reactions.userId,
          createdAt: reactions.createdAt,
          user: { id: profiles.id, name: profiles.name, avatarUrl: profiles.avatarUrl },
        })
        .from(reactions)
        .leftJoin(profiles, eq(reactions.userId, profiles.id))
        .where(eq(reactions.videoId, access.video.id))
        .orderBy(asc(reactions.createdAt));
    }),

  add: publicProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        shareToken: shareTokenInput,
        emoji: z.string().min(1).max(8),
        timestampMs: z.number().int().nonnegative().optional(),
        anonymousId: anonymousIdInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveVideoAccess(ctx, {
        videoId: input.videoId,
        token: input.shareToken,
      });
      if (!access.allow.allowReactions && !access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Reactions are disabled for this video" });
      }
      if (!ctx.user && !input.anonymousId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "anonymousId is required for anonymous reactions",
        });
      }

      const [created] = await ctx.db
        .insert(reactions)
        .values({
          videoId: access.video.id,
          userId: ctx.user?.id ?? null,
          anonymousId: ctx.user ? null : (input.anonymousId ?? null),
          emoji: input.emoji,
          timestampMs: input.timestampMs,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await ctx.db
        .update(videos)
        .set({ reactionCount: sql`${videos.reactionCount} + 1` })
        .where(eq(videos.id, access.video.id));

      return created;
    }),

  remove: publicProcedure
    .input(z.object({ reactionId: z.string().uuid(), anonymousId: anonymousIdInput }))
    .mutation(async ({ ctx, input }) => {
      const reaction = await ctx.db.query.reactions.findFirst({
        where: eq(reactions.id, input.reactionId),
      });
      if (!reaction) throw new TRPCError({ code: "NOT_FOUND" });

      const ownsByUser = Boolean(
        ctx.user && reaction.userId && reaction.userId === ctx.user.id,
      );
      const ownsByAnon = Boolean(
        input.anonymousId && reaction.anonymousId && reaction.anonymousId === input.anonymousId,
      );
      if (!ownsByUser && !ownsByAnon) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only remove your own reaction" });
      }

      await ctx.db.delete(reactions).where(eq(reactions.id, reaction.id));
      await ctx.db
        .update(videos)
        .set({ reactionCount: sql`greatest(${videos.reactionCount} - 1, 0)` })
        .where(eq(videos.id, reaction.videoId));

      return { ok: true };
    }),
});
