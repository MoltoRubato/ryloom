import "server-only";

import { r2DeletePrefix, r2SignedGetUrl } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Storage layout — two backends, routed by logical bucket:
 * - raw-recordings, processed-videos → Cloudflare R2 (one private bucket,
 *   zero egress; object keys are identical to the paths below)
 * - thumbnails, captions, avatars, workspace-assets, exports → Supabase
 *   Storage (small assets; buckets created by supabase/migrations)
 */
export const BUCKETS = {
  raw: "raw-recordings",
  processed: "processed-videos",
  thumbnails: "thumbnails",
  captions: "captions",
  avatars: "avatars",
  workspaceAssets: "workspace-assets",
  exports: "exports",
} as const;

/** Logical buckets whose bytes live in R2 (video media plane). */
const R2_BUCKETS: ReadonlySet<string> = new Set([BUCKETS.raw, BUCKETS.processed]);

export function isR2Bucket(bucket: string): boolean {
  return R2_BUCKETS.has(bucket);
}

export const storagePaths = {
  rawRecording: (workspaceId: string, videoId: string, ext = "webm") =>
    `workspaces/${workspaceId}/videos/${videoId}/raw/source.${ext}`,
  processedMp4: (workspaceId: string, videoId: string, label = "1080p") =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/${label}.mp4`,
  hlsMaster: (workspaceId: string, videoId: string) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/hls/master.m3u8`,
  thumbnail: (workspaceId: string, videoId: string, name = "default.jpg") =>
    `workspaces/${workspaceId}/videos/${videoId}/thumbs/${name}`,
  captions: (workspaceId: string, videoId: string, lang = "en", fmt = "vtt") =>
    `workspaces/${workspaceId}/videos/${videoId}/captions/${lang}.${fmt}`,
  avatar: (userId: string) => `users/${userId}/avatar.jpg`,
  workspaceLogo: (workspaceId: string) => `workspaces/${workspaceId}/logo.png`,
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6; // 6h

export async function createSignedUrl(
  bucket: string,
  path: string,
  ttl: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (isR2Bucket(bucket)) {
    try {
      return await r2SignedGetUrl(path, ttl);
    } catch {
      return null;
    }
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttl);
  if (error) return null;
  return data.signedUrl;
}

/** Public-bucket URL — Supabase-hosted assets only (thumbnails, captions…). */
export function publicUrl(bucket: string, path: string): string {
  const supabase = createAdminClient();
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function deletePrefix(bucket: string, prefix: string): Promise<void> {
  if (isR2Bucket(bucket)) {
    await r2DeletePrefix(prefix);
    return;
  }
  const supabase = createAdminClient();
  // Supabase storage has no recursive delete; list then remove in pages.
  for (;;) {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100 });
    if (error || !files || files.length === 0) break;
    const paths = files.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(bucket).remove(paths);
    if (files.length < 100) break;
  }
}
