import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createClient } from "@supabase/supabase-js";

import { env } from "./env";
import { r2DeleteObject, r2DeletePrefix, r2DownloadToFile, r2UploadFile } from "./r2";

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
  // Ladders are written to a versioned prefix (hls-<version>) so a rebuild
  // never overwrites segments an in-flight viewer is still streaming; the
  // /api/hls proxy derives the prefix from videos.hlsUrl. The unversioned
  // form remains for ladders created before versioning shipped.
  hlsDir: (workspaceId: string, videoId: string, version?: string) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/${version ? `hls-${version}` : "hls"}`,
  hlsMaster: (workspaceId: string, videoId: string, version?: string) =>
    `workspaces/${workspaceId}/videos/${videoId}/processed/${version ? `hls-${version}` : "hls"}/master.m3u8`,
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

/** Deletes a single storage object (e.g. a pruned playback backup). */
export async function deleteFile(bucket: string, storagePath: string): Promise<void> {
  if (R2_BUCKETS.has(bucket)) {
    await r2DeleteObject(storagePath);
    return;
  }
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    throw new Error(`Storage delete failed (${bucket}/${storagePath}): ${error.message}`);
  }
}

/** Deletes every object under a prefix (e.g. a superseded HLS ladder). */
export async function deletePrefix(bucket: string, storagePrefix: string): Promise<void> {
  if (!R2_BUCKETS.has(bucket)) {
    throw new Error(`deletePrefix is only implemented for R2 buckets (got ${bucket})`);
  }
  await r2DeletePrefix(storagePrefix);
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

const UPLOAD_DIR_CONCURRENCY = 8;

/**
 * Recursively uploads a local directory to a storage prefix with a pool of
 * 8 concurrent PUTs — an HLS ladder is hundreds of small segments, and
 * serial uploads dominate wall time.
 */
export async function uploadDir(
  bucket: string,
  storagePrefix: string,
  localDir: string,
): Promise<number> {
  const files: { localPath: string; remotePath: string }[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const localPath = path.join(dir, entry.name);
      const remotePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(localPath, remotePath);
      } else if (entry.isFile()) {
        files.push({ localPath, remotePath });
      }
    }
  };
  await walk(localDir, storagePrefix);

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_DIR_CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++]!;
        await uploadFile(
          bucket,
          file.remotePath,
          file.localPath,
          contentTypeFor(file.localPath),
          true,
        );
      }
    }),
  );
  return files.length;
}

/** Full public URL for objects in public buckets (thumbnails, captions). */
export function publicUrl(bucket: string, storagePath: string): string {
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}
