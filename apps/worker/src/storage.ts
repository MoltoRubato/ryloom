import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createClient } from "@supabase/supabase-js";

import { env } from "./env";
import { r2DownloadToFile, r2UploadFile } from "./r2";

/** Bucket names — must stay in sync with apps/web/src/lib/storage.ts */
export const BUCKETS = {
  raw: "raw-recordings",
  processed: "processed-videos",
  thumbnails: "thumbnails",
  captions: "captions",
} as const;

/**
 * raw + processed video bytes live in Cloudflare R2 (single bucket, same
 * object keys); thumbnails + captions stay in public Supabase buckets.
 */
const R2_BUCKETS: ReadonlySet<string> = new Set([BUCKETS.raw, BUCKETS.processed]);

/** Storage path builders — mirror apps/web/src/lib/storage.ts `storagePaths`. */
export const storagePaths = {
  rawRecording: (workspaceId: string, videoId: string, ext = "webm") =>
    `workspaces/${workspaceId}/videos/${videoId}/raw/source.${ext}`,
  processedMp4: (workspaceId: string, videoId: string, label = "1080p") =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/${label}.mp4`,
  processedBackup: (workspaceId: string, videoId: string, millis: number) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/backup-${millis}.mp4`,
  hlsDir: (workspaceId: string, videoId: string) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/hls`,
  hlsMaster: (workspaceId: string, videoId: string) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/hls/master.m3u8`,
  thumbnail: (workspaceId: string, videoId: string, name = "default.jpg") =>
    `workspaces/${workspaceId}/videos/${videoId}/thumbs/${name}`,
  captions: (workspaceId: string, videoId: string, lang = "en", fmt = "vtt") =>
    `workspaces/${workspaceId}/videos/${videoId}/captions/${lang}.${fmt}`,
};

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Streams a storage object to a local file. */
export async function downloadToFile(
  bucket: string,
  storagePath: string,
  destFile: string,
): Promise<void> {
  if (R2_BUCKETS.has(bucket)) {
    await r2DownloadToFile(storagePath, destFile);
    return;
  }
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new Error(
      `Storage download failed (${bucket}/${storagePath}): ${error?.message ?? "no data"}`,
    );
  }
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  const webStream = data.stream();
  await pipeline(
    Readable.fromWeb(webStream as import("node:stream/web").ReadableStream),
    createWriteStream(destFile),
  );
}

/** Uploads a local file to storage (upsert by default). */
export async function uploadFile(
  bucket: string,
  storagePath: string,
  localFile: string,
  contentType: string,
  upsert = true,
): Promise<void> {
  if (R2_BUCKETS.has(bucket)) {
    // R2 PUTs always overwrite; chunked upload keeps memory bounded.
    await r2UploadFile(storagePath, localFile, contentType);
    return;
  }
  const body = await fs.readFile(localFile);
  const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
    contentType,
    upsert,
    cacheControl: "3600",
  });
  if (error) {
    throw new Error(`Storage upload failed (${bucket}/${storagePath}): ${error.message}`);
  }
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/mp4",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".json": "application/json",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
};

export function contentTypeFor(file: string): string {
  return EXT_CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Recursively uploads a local directory to a storage prefix.
 * Used for the HLS ladder (master.m3u8 + rendition playlists + segments).
 */
export async function uploadDir(
  bucket: string,
  storagePrefix: string,
  localDir: string,
): Promise<number> {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  let uploaded = 0;
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${storagePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      uploaded += await uploadDir(bucket, remotePath, localPath);
    } else if (entry.isFile()) {
      await uploadFile(bucket, remotePath, localPath, contentTypeFor(entry.name), true);
      uploaded += 1;
    }
  }
  return uploaded;
}

/** Full public URL for objects in public buckets (thumbnails, captions). */
export function publicUrl(bucket: string, storagePath: string): string {
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}
