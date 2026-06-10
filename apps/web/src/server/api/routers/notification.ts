import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { notifications, profiles } from "@ryloom/db";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          notification: notifications,
          actor: {
            id: profiles.id,
            name: profiles.name,
            avatarUrl: profiles.avatarUrl,
            email: profiles.email,
          },
        })
        .from(notifications)
        .leftJoin(profiles, eq(notifications.actorId, profiles.id))
        .where(eq(notifications.userId, ctx.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = rows.length > input.limit;
      return {
        items: rows.slice(0, input.limit),
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  /** Marks one notification read, or all of them when no id is given. */
  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid().optional() }).default({}))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, ctx.user.id),
            isNull(notifications.readAt),
            input.id ? eq(notifications.id, input.id) : undefined,
          ),
        );
      return { ok: true };
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { count: row?.count ?? 0 };
  }),
});
