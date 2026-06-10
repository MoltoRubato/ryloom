import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { folders, videos } from "@ryloom/db";

import {
  ADMIN_ROLES,
  CREATOR_ROLES,
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

async function getManagedFolder(
  ctx: TRPCContext & { user: NonNullable<TRPCContext["user"]> },
  folderId: string,
): Promise<{ folder: typeof folders.$inferSelect; membership: Membership }> {
  const folder = await ctx.db.query.folders.findFirst({ where: eq(folders.id, folderId) });
  if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
  const membership = await requireMembership(ctx, folder.workspaceId);
  const canManage =
    folder.createdBy === ctx.user.id ||
    ADMIN_ROLES.includes(membership.role) ||
    membership.role === "content_admin";
  if (!canManage) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't manage this folder" });
  }
  return { folder, membership };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const folderRouter = createTRPCRouter({
  /** Folders + spaces for the sidebar, each with a live video count. */
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId);
      return ctx.db
        .select({
          folder: folders,
          videoCount: sql<number>`count(${videos.id}) filter (where ${videos.status} not in ('deleted', 'archived'))`.mapWith(
            Number,
          ),
        })
        .from(folders)
        .leftJoin(videos, eq(videos.folderId, folders.id))
        .where(eq(folders.workspaceId, input.workspaceId))
        .groupBy(folders.id)
        .orderBy(desc(folders.isPinned), asc(folders.name));
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100),
        parentId: z.string().uuid().nullish(),
        isSpace: z.boolean().default(false),
        emoji: z.string().max(16).optional(),
        color: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, CREATOR_ROLES);
      requirePlanFeature(membership, "folders", "Folders");
      if (input.isSpace) requirePlanFeature(membership, "teamSpaces", "Team spaces");

      if (input.parentId) {
        const parent = await ctx.db.query.folders.findFirst({
          where: and(eq(folders.id, input.parentId), eq(folders.workspaceId, input.workspaceId)),
        });
        if (!parent) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Parent folder not found" });
        }
      }

      const [created] = await ctx.db
        .insert(folders)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          parentId: input.parentId ?? null,
          isSpace: input.isSpace,
          emoji: input.emoji,
          color: input.color,
          createdBy: ctx.user.id,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        folderId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        emoji: z.string().max(16).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        isPinned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { folder } = await getManagedFolder(ctx, input.folderId);
      const { folderId: _folderId, ...fields } = input;
      const [updated] = await ctx.db
        .update(folders)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(folders.id, folder.id))
        .returning();
      return updated;
    }),

  /** Deletes a folder; its videos move to the library root, children move up. */
  delete: protectedProcedure
    .input(z.object({ folderId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { folder } = await getManagedFolder(ctx, input.folderId);
      await ctx.db
        .update(videos)
        .set({ folderId: null, updatedAt: new Date() })
        .where(eq(videos.folderId, folder.id));
      await ctx.db
        .update(folders)
        .set({ parentId: folder.parentId, updatedAt: new Date() })
        .where(eq(folders.parentId, folder.id));
      await ctx.db.delete(folders).where(eq(folders.id, folder.id));
      return { ok: true };
    }),
});
