import "server-only";

import { eq } from "drizzle-orm";

import { videos, videoShares } from "@ryloom/db";

import { db } from "@/server/db";

/**
 * Resolves a share token to a video that is *publicly* viewable — i.e. the
 * effective privacy of the link is "public", the link is enabled and not
 * expired, and the video isn't deleted/archived.
 *
 * Used by the unauthenticated surfaces that crawlers and chat apps hit:
 * the OG video stream endpoint and the oEmbed endpoint. Anything stricter
 * than "public" (workspace / specific / password / private) returns null —
 * those viewers must go through the share page's own gates.
 */
export async function resolvePublicSharedVideo(token: string) {
  if (!token || token.length < 6 || token.length > 64) return null;

  let video = await db.query.videos.findFirst({
    where: eq(videos.shareToken, token),
  });
  let link: typeof videoShares.$inferSelect | null = null;
  if (!video) {
    link =
      (await db.query.videoShares.findFirst({
        where: eq(videoShares.token, token),
      })) ?? null;
    if (link) {
      video =
        (await db.query.videos.findFirst({ where: eq(videos.id, link.videoId) })) ??
        undefined;
    }
  }
  if (!video || video.status === "deleted" || video.status === "archived") return null;

  const disabled = link ? link.revokedAt !== null : video.linkDisabled;
  const expiresAt = link ? link.expiresAt : video.linkExpiresAt;
  const privacy = link ? link.privacyType : video.privacy;
  const allowEmbed = link ? link.allowEmbed && video.allowEmbed : video.allowEmbed;

  if (disabled) return null;
  if (expiresAt && expiresAt < new Date()) return null;
  if (privacy !== "public") return null;
  // Viewer-identity / domain gates require an interactive viewer.
  if (video.requireViewerIdentity) return null;
  const domainRestriction = link ? (link.domainRestriction ?? video.domainRestriction) : video.domainRestriction;
  if (domainRestriction?.length) return null;

  return { video, allowEmbed };
}
