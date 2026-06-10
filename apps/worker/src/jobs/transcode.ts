import fs from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { notifications, videoAssets, videos } from "@ryloom/db";

import { db } from "../db";
import { env } from "../env";
import {
  fitDimensions,
  gifPreview,
  hlsLadder,
  probe,
  thumbnail,
  transcodeMp4,
  waveformJson,
} from "../ffmpeg";
import { enqueueJob, type ClaimedJob } from "../queue";
import {
  BUCKETS,
  downloadToFile,
  publicUrl,
  storagePaths,
  uploadDir,
  uploadFile,
} from "../storage";
import { cleanupDir, createWorkDir, getVideoOrThrow, type VideoRow } from "./_shared";

const transcodeInput = z.object({
  sourceBucket: z.string().min(1),
  sourcePath: z.string().min(1),
  mimeType: z.string().optional(),
  /** Plan cap; null means uncapped (we still cap at 4K). */
  maxHeight: z.number().int().positive().nullish(),
  hls: z.boolean().nullish(),
  transcribe: z.boolean().nullish(),
  autoAi: z.boolean().nullish(),
  revert: z.boolean().nullish(),
});

/**
 * The full ingest pipeline, reusable by the stitch job:
 * probe → MP4 transcode → thumbnail → GIF preview → waveform →
 * optional HLS ladder → uploads → video_assets rows → videos row →
 * video_ready notification → chained transcribe job.
 *
 * Contract reminders:
 *  - playbackUrl / hlsUrl are STORAGE PATHS (the web app signs them),
 *  - thumbnailUrl / animatedThumbnailUrl / waveformUrl are FULL PUBLIC URLS.
 */
export async function processVideoFile(params: {
  video: VideoRow;
  localSource: string;
  workDir: string;
  maxHeight: number;
  hls: boolean;
  chainTranscribe: boolean;
  autoAi: boolean;
  notifyReady: boolean;
}): Promise<Record<string, unknown>> {
  const { video, localSource, workDir } = params;

  const src = await probe(localSource);
  if (src.width === 0 || src.height === 0) {
    throw new Error("Source file contains no decodable video stream");
  }

  // --- Transcode the playback MP4 -------------------------------------------
  const dims = fitDimensions(src.width, src.height, params.maxHeight);
  const label = `${dims.height}p`;
  const mp4Local = path.join(workDir, `${label}.mp4`);
  await transcodeMp4({
    input: localSource,
    output: mp4Local,
    maxHeight: params.maxHeight,
    hasAudio: src.hasAudio,
  });

  const out = await probe(mp4Local);
  const durationMs = out.durationMs || src.durationMs;
  const mp4Stat = await fs.stat(mp4Local);

  // --- Derived media ----------------------------------------------------------
  const thumbLocal = path.join(workDir, "default.jpg");
  await thumbnail(mp4Local, thumbLocal, durationMs * 0.25);

  const gifLocal = path.join(workDir, "preview.gif");
  await gifPreview(mp4Local, gifLocal, durationMs);

  const waveform = await waveformJson(mp4Local, out.hasAudio);
  const waveformLocal = path.join(workDir, "waveform.json");
  await fs.writeFile(waveformLocal, JSON.stringify(waveform), "utf8");

  let renditions: Awaited<ReturnType<typeof hlsLadder>> = [];
  const hlsLocal = path.join(workDir, "hls");
  if (params.hls) {
    renditions = await hlsLadder({
      input: mp4Local,
      outDir: hlsLocal,
      maxHeight: params.maxHeight,
      sourceWidth: out.width,
      sourceHeight: out.height,
      hasAudio: out.hasAudio,
    });
  }

  // --- Uploads -----------------------------------------------------------------
  const mp4Path = storagePaths.processedMp4(video.workspaceId, video.id, label);
  const thumbPath = storagePaths.thumbnail(video.workspaceId, video.id, "default.jpg");
  const gifPath = storagePaths.thumbnail(video.workspaceId, video.id, "preview.gif");
  const waveformPath = storagePaths.thumbnail(video.workspaceId, video.id, "waveform.json");
  const hlsMasterPath = storagePaths.hlsMaster(video.workspaceId, video.id);

  await uploadFile(BUCKETS.processed, mp4Path, mp4Local, "video/mp4", true);
  await uploadFile(BUCKETS.thumbnails, thumbPath, thumbLocal, "image/jpeg", true);
  await uploadFile(BUCKETS.thumbnails, gifPath, gifLocal, "image/gif", true);
  await uploadFile(BUCKETS.thumbnails, waveformPath, waveformLocal, "application/json", true);
  if (params.hls) {
    await uploadDir(
      BUCKETS.processed,
      storagePaths.hlsDir(video.workspaceId, video.id),
      hlsLocal,
    );
  }

  // --- video_assets rows ----------------------------------------------------------
  const assetRows: (typeof videoAssets.$inferInsert)[] = [
    {
      videoId: video.id,
      type: "mp4",
      storageBucket: BUCKETS.processed,
      storagePath: mp4Path,
      mimeType: "video/mp4",
      sizeBytes: mp4Stat.size,
      width: out.width,
      height: out.height,
      durationMs,
      label,
      status: "ready",
    },
    {
      videoId: video.id,
      type: "thumbnail",
      storageBucket: BUCKETS.thumbnails,
      storagePath: thumbPath,
      mimeType: "image/jpeg",
      label: "default",
      status: "ready",
    },
    {
      videoId: video.id,
      type: "gif",
      storageBucket: BUCKETS.thumbnails,
      storagePath: gifPath,
      mimeType: "image/gif",
      label: "preview",
      status: "ready",
    },
    {
      videoId: video.id,
      type: "waveform",
      storageBucket: BUCKETS.thumbnails,
      storagePath: waveformPath,
      mimeType: "application/json",
      label: "waveform",
      status: "ready",
    },
  ];
  if (params.hls) {
    assetRows.push({
      videoId: video.id,
      type: "hls",
      storageBucket: BUCKETS.processed,
      storagePath: hlsMasterPath,
      mimeType: "application/vnd.apple.mpegurl",
      durationMs,
      label: "hls",
      status: "ready",
      metadata: { renditions },
    });
  }
  await db.insert(videoAssets).values(assetRows);

  // --- videos row -------------------------------------------------------------------
  await db
    .update(videos)
    .set({
      status: "ready",
      durationMs,
      width: out.width,
      height: out.height,
      fps: out.fps,
      sizeBytes: mp4Stat.size,
      playbackUrl: mp4Path,
      hlsUrl: params.hls ? hlsMasterPath : null,
      thumbnailUrl: publicUrl(BUCKETS.thumbnails, thumbPath),
      animatedThumbnailUrl: publicUrl(BUCKETS.thumbnails, gifPath),
      waveformUrl: publicUrl(BUCKETS.thumbnails, waveformPath),
      processingError: null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));

  if (params.notifyReady) {
    await db.insert(notifications).values({
      userId: video.ownerId,
      type: "video_ready",
      workspaceId: video.workspaceId,
      videoId: video.id,
      title: "Your video is ready",
      body: video.title,
      data: { durationMs, label },
    });
  }

  if (params.chainTranscribe && env.OPENAI_API_KEY) {
    await enqueueJob({
      videoId: video.id,
      workspaceId: video.workspaceId,
      type: "transcribe",
      inputJson: { autoAi: params.autoAi },
    });
  }

  return {
    label,
    durationMs,
    width: out.width,
    height: out.height,
    fps: out.fps,
    sizeBytes: mp4Stat.size,
    hasAudio: out.hasAudio,
    hls: params.hls,
    renditions: renditions.map((r) => `${r.height}p`),
  };
}

export async function runTranscodeJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("transcode job is missing videoId");
  const input = transcodeInput.parse(job.inputJson);
  const video = await getVideoOrThrow(job.videoId);
  const revert = input.revert === true;

  // maxHeight: null from the plan means "uncapped" — we still cap at 4K.
  const maxHeight = input.maxHeight === null ? 2160 : (input.maxHeight ?? 1080);
  // For reverts the enqueue site sends no hls flag — keep the ladder if the
  // video had one so playback doesn't silently lose HLS.
  const hls = input.hls ?? (revert ? video.hlsUrl !== null : false);

  const workDir = await createWorkDir(job.id);
  try {
    const ext = path.extname(input.sourcePath) || ".webm";
    const localSource = path.join(workDir, `source${ext}`);
    await downloadToFile(input.sourceBucket, input.sourcePath, localSource);

    return await processVideoFile({
      video,
      localSource,
      workDir,
      maxHeight,
      hls,
      // revert:true skips the transcribe → AI chain.
      chainTranscribe: !revert && (input.transcribe ?? true),
      autoAi: input.autoAi ?? true,
      notifyReady: true,
    });
  } finally {
    await cleanupDir(workDir);
  }
}
