import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Storage buckets. Created by supabase/migrations — keep names in sync.
 * - raw-recordings:    private; TUS resumable uploads land here
 * - processed-videos:  private; worker writes MP4/HLS renditions
 * - thumbnails:        public read
 * - captions:          public read
 * - avatars:           public read
 * - workspace-assets:  public read (logos, branding)
 * - exports:           private (CSV/data exports)
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
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttl);
  if (error) return null;
  return data.signedUrl;
}

export function publicUrl(bucket: string, path: string): string {
  const supabase = createAdminClient();
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function deletePrefix(bucket: string, prefix: string): Promise<void> {
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
