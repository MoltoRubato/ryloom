import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";

import { videoPermissions, videos, videoShares } from "@ryloom/db";

import {
  ADMIN_ROLES,
  requireMembership,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared video access resolution for comment / reaction / transcript routers
// ---------------------------------------------------------------------------

/**
 * Effective allow-flags for a video. A share-link row narrows the video
 * defaults — modeled on `effectiveShareSettings` in routers/video.ts.
 */
export type VideoAllowFlags = {
  allowDownload: boolean;
  allowComments: boolean;
  allowReactions: boolean;
  allowTranscript: boolean;
  allowEmbed: boolean;
};

export type VideoAccess = {
  video: typeof videos.$inferSelect;
  allow: VideoAllowFlags;
  /** The caller owns this video (owners always retain full access). */
  isOwner: boolean;
  /** Extra share-link row id when access came through one, else null. */
  shareId: string | null;
  /** Access was resolved through a share token (public viewer path). */
  viaToken: boolean;
};

function allowFlags(
  video: typeof videos.$inferSelect,
  link: typeof videoShares.$inferSelect | null,
): VideoAllowFlags {
  if (link) {
    return {
      allowDownload: link.allowDownload && video.allowDownload,
      allowComments: link.allowComments && video.allowComments,
      allowReactions: link.allowReactions && video.allowReactions,
      allowTranscript: link.allowTranscript && video.allowTranscript,
      allowEmbed: link.allowEmbed && video.allowEmbed,
    };
  }
  return {
    allowDownload: video.allowDownload,
    allowComments: video.allowComments,
    allowReactions: video.allowReactions,
    allowTranscript: video.allowTranscript,
    allowEmbed: video.allowEmbed,
  };
}

/**
 * Resolves read access to a video for comment/reaction/transcript procedures.
 *
 * - With a `token`: resolves the video by its primary share token or an extra
 *   share link, then applies the same privacy gates as `video.getByShareToken`
 *   minus the password/identity round-trips — possession of an enabled,
 *   unexpired link to a public/password video is sufficient for these
 *   lightweight reads; workspace/specific links still require membership.
 * - Without a token: requires an authenticated workspace member; private
 *   videos stay restricted to the owner and workspace admins.
 *
 * Routers must never return the raw `video` row from a public procedure —
 * it contains `passwordHash` and other private fields.
 */
export async function resolveVideoAccess(
  ctx: TRPCContext,
  opts: { videoId?: string; token?: string },
): Promise<VideoAccess> {
  if (opts.token) {
    // Primary token on the video, else an extra share link.
    let video = await ctx.db.query.videos.findFirst({
      where: eq(videos.shareToken, opts.token),
    });
    let link: typeof videoShares.$inferSelect | null = null;
    if (!video) {
      link =
        (await ctx.db.query.videoShares.findFirst({
          where: eq(videoShares.token, opts.token),
        })) ?? null;
      if (link) {
        video =
          (await ctx.db.query.videos.findFirst({ where: eq(videos.id, link.videoId) })) ??
          undefined;
      }
    }
    if (!video || video.status === "deleted" || video.status === "archived") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
    }
    if (opts.videoId && video.id !== opts.videoId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This link doesn't match that video" });
    }

    const isOwner = ctx.user?.id === video.ownerId;
    if (!isOwner) {
      const disabled = link ? link.revokedAt !== null : video.linkDisabled;
      const expiresAt = link ? link.expiresAt : video.linkExpiresAt;
      const privacy = link ? link.privacyType : video.privacy;

      if (disabled) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This link has been disabled" });
      }
      if (expiresAt && expiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired" });
      }
      switch (privacy) {
        case "private": {
          throw new TRPCError({ code: "FORBIDDEN", message: "This video is private" });
        }
        case "workspace": {
          if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
          await requireMembership({ db: ctx.db, user: ctx.user }, video.workspaceId);
          break;
        }
        case "specific": {
          if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
          const grant = await ctx.db.query.videoPermissions.findFirst({
            where: and(
              eq(videoPermissions.videoId, video.id),
              or(
                eq(videoPermissions.userId, ctx.user.id),
                eq(videoPermissions.email, ctx.user.email),
              ),
            ),
          });
          if (!grant) {
            // Workspace admins can always view
            try {
              await requireMembership(
                { db: ctx.db, user: ctx.user },
                video.workspaceId,
                ADMIN_ROLES,
              );
            } catch {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You don't have access to this video",
              });
            }
          }
          break;
        }
        case "password":
        case "public":
          break;
      }
    }

    return {
      video,
      allow: allowFlags(video, link),
      isOwner: Boolean(isOwner),
      shareId: link?.id ?? null,
      viaToken: true,
    };
  }

  // --- Authenticated member path (no token) ---
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!opts.videoId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "videoId or shareToken is required" });
  }
  const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, opts.videoId) });
  if (!video || video.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }
  const membership = await requireMembership({ db: ctx.db, user: ctx.user }, video.workspaceId);
  const isOwner = video.ownerId === ctx.user.id;
  const isPrivileged = isOwner || ADMIN_ROLES.includes(membership.role);
  if (video.privacy === "private" && !isPrivileged) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This video is private" });
  }
  return {
    video,
    allow: allowFlags(video, null),
    isOwner,
    shareId: null,
    viaToken: false,
  };
}
