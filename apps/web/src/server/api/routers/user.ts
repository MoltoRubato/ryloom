import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
  comments,
  profiles,
  videos,
  workspaceMembers,
  workspaces,
} from "@ryloom/db";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createTRPCRouter,
  getOrCreateProfile,
  protectedProcedure,
  requireMembership,
  type WorkspaceRole,
} from "@/server/api/trpc";

/** Preference order when handing a workspace's created_by to another member. */
const SUCCESSOR_ROLE_ORDER: WorkspaceRole[] = [
  "owner",
  "admin",
  "content_admin",
  "billing_admin",
  "compliance_admin",
  "member",
  "viewer",
  "guest",
];

export const userRouter = createTRPCRouter({
  /** Current user's profile — created on first call, touches lastSeenAt. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getOrCreateProfile(ctx);
    const [updated] = await ctx.db
      .update(profiles)
      .set({ lastSeenAt: new Date() })
      .where(eq(profiles.id, ctx.user.id))
      .returning();
    return updated ?? profile;
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120).optional(),
        avatarUrl: z.string().url().nullable().optional(),
        timezone: z.string().min(1).max(64).optional(),
        defaultWorkspaceId: z.string().uuid().optional(),
        onboardingCompleted: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOrCreateProfile(ctx);
      if (input.defaultWorkspaceId) {
        await requireMembership(ctx, input.defaultWorkspaceId);
      }
      const [updated] = await ctx.db
        .update(profiles)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(profiles.id, ctx.user.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return updated;
    }),

  /**
   * Permanently deletes the auth user; the profiles row cascades via FK from
   * auth.users. workspaces.created_by restricts profile deletion, so any
   * workspace the user created is first handed to another active member
   * (preferring owners/admins) — or deleted outright when they were the only
   * member.
   */
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const created = await ctx.db.query.workspaces.findMany({
      where: eq(workspaces.createdBy, ctx.user.id),
      columns: { id: true },
    });

    for (const ws of created) {
      const others = await ctx.db.query.workspaceMembers.findMany({
        where: and(
          eq(workspaceMembers.workspaceId, ws.id),
          ne(workspaceMembers.userId, ctx.user.id),
          eq(workspaceMembers.status, "active"),
        ),
      });
      const heir = [...others].sort(
        (a, b) =>
          SUCCESSOR_ROLE_ORDER.indexOf(a.role as WorkspaceRole) -
          SUCCESSOR_ROLE_ORDER.indexOf(b.role as WorkspaceRole),
      )[0];

      if (!heir) {
        // Sole member — the workspace (and its content) goes with the account.
        await ctx.db.delete(workspaces).where(eq(workspaces.id, ws.id));
        continue;
      }
      await ctx.db
        .update(workspaces)
        .set({ createdBy: heir.userId, updatedAt: new Date() })
        .where(eq(workspaces.id, ws.id));
      // Make sure the workspace keeps an owner after the membership cascades.
      if (heir.role !== "owner") {
        const otherOwner = others.find((m) => m.role === "owner");
        if (!otherOwner) {
          await ctx.db
            .update(workspaceMembers)
            .set({ role: "owner" })
            .where(
              and(
                eq(workspaceMembers.workspaceId, ws.id),
                eq(workspaceMembers.userId, heir.userId),
              ),
            );
        }
      }
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Account deletion failed: ${error.message}`,
      });
    }
    return { ok: true };
  }),

  /** GDPR-style takeout: profile, memberships, video metadata, comments. */
  exportData: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getOrCreateProfile(ctx);

    const memberships = await ctx.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        workspaceName: workspaces.name,
        role: workspaceMembers.role,
        status: workspaceMembers.status,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, ctx.user.id))
      .orderBy(workspaceMembers.joinedAt);

    // Metadata only — no media URLs, storage paths or password hashes.
    const ownedVideos = await ctx.db
      .select({
        id: videos.id,
        workspaceId: videos.workspaceId,
        folderId: videos.folderId,
        title: videos.title,
        description: videos.description,
        status: videos.status,
        privacy: videos.privacy,
        durationMs: videos.durationMs,
        width: videos.width,
        height: videos.height,
        sizeBytes: videos.sizeBytes,
        tags: videos.tags,
        viewCount: videos.viewCount,
        uniqueViewerCount: videos.uniqueViewerCount,
        commentCount: videos.commentCount,
        reactionCount: videos.reactionCount,
        createdAt: videos.createdAt,
        updatedAt: videos.updatedAt,
      })
      .from(videos)
      .where(and(eq(videos.ownerId, ctx.user.id), ne(videos.status, "deleted")))
      .orderBy(desc(videos.createdAt));

    const authoredComments = await ctx.db
      .select({
        id: comments.id,
        videoId: comments.videoId,
        parentCommentId: comments.parentCommentId,
        timestampMs: comments.timestampMs,
        body: comments.body,
        status: comments.status,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(and(eq(comments.authorId, ctx.user.id), ne(comments.status, "deleted")))
      .orderBy(desc(comments.createdAt));

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        timezone: profile.timezone,
        onboardingCompleted: profile.onboardingCompleted,
        createdAt: profile.createdAt,
      },
      memberships,
      videos: ownedVideos,
      comments: authoredComments,
    };
  }),
});
