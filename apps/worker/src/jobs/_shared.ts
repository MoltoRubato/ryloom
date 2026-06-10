import fs from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { transcripts, videoAssets, videos } from "@ryloom/db";

import { db } from "../db";
import { env } from "../env";
import {
  cutKeepRanges,
  gifPreview,
  hlsLadder,
  probe,
  thumbnail,
  waveformJson,
  type MsRange,
} from "../ffmpeg";
import { enqueueJob, type ClaimedJob } from "../queue";
import {
  BUCKETS,
  downloadToFile,
  storagePaths,
  uploadDir,
  uploadFile,
} from "../storage";

export type VideoRow = typeof videos.$inferSelect;

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

export async function getVideoOrThrow(videoId: string): Promise<VideoRow> {
  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video) throw new Error(`Video ${videoId} not found`);
  return video;
}

export async function createWorkDir(jobId: string): Promise<string> {
  const dir = path.join(env.TMP_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort — scratch space is also wiped on container restart.
  }
}

/** Sorts + merges overlapping/adjacent ranges. */
export function mergeRanges(ranges: MsRange[], joinGapMs = 0): MsRange[] {
  const sorted = [...ranges]
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: MsRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.startMs <= last.endMs + joinGapMs) {
      last.endMs = Math.max(last.endMs, r.endMs);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Inverts cut ranges into keep ranges over [0, durationMs], dropping keep
 * segments shorter than minKeepMs (they cause concat glitches).
 */
export function invertToKeepRanges(
  cuts: MsRange[],
  durationMs: number,
  minKeepMs: number,
): MsRange[] {
  const clamped = mergeRanges(
    cuts.map((c) => ({
      startMs: Math.max(0, Math.min(c.startMs, durationMs)),
      endMs: Math.max(0, Math.min(c.endMs, durationMs)),
    })),
  );
  const keeps: MsRange[] = [];
  let cursor = 0;
  for (const cut of clamped) {
    if (cut.startMs - cursor >= minKeepMs) {
      keeps.push({ startMs: cursor, endMs: cut.startMs });
    }
    cursor = Math.max(cursor, cut.endMs);
  }
  if (durationMs - cursor >= minKeepMs) {
    keeps.push({ startMs: cursor, endMs: durationMs });
  }
  return keeps;
}

/** Restores a video the web app flipped to `processing` back to `ready`. */
export async function restoreVideoReady(videoId: string): Promise<void> {
  await db
    .update(videos)
    .set({ status: "ready", processingError: null, updatedAt: new Date() })
    .where(eq(videos.id, videoId));
}

export async function findReadyTranscript(videoId: string) {
  return db.query.transcripts.findFirst({
    where: and(eq(transcripts.videoId, videoId), eq(transcripts.status, "ready")),
    orderBy: desc(transcripts.createdAt),
  });
}

// ---------------------------------------------------------------------------
// Re-render engine — shared by trim / silence_removal / filler_removal
// ---------------------------------------------------------------------------

export type ReRenderResult = {
  durationMs: number;
  sizeBytes: number;
  removedMs: number;
};

/**
 * Re-renders the current playback MP4 keeping only `keepRanges`:
 *  1. backs up the current MP4 to processed/backup-{millis}.mp4 + an
 *     `original_backup` asset row (revertToOriginal uses the latest one),
 *  2. cuts with trim/atrim+concat and uploads over the SAME playback path,
 *  3. regenerates thumbnail / GIF preview / waveform (+ HLS ladder when the
 *     video had one),
 *  4. updates the videos row and re-enqueues transcription if a ready
 *     transcript existed (timings shifted).
 */
export async function reRenderWithKeepRanges(params: {
  job: ClaimedJob;
  video: VideoRow;
  workDir: string;
  keepRanges: MsRange[];
  /** Pass when the playback MP4 was already downloaded (e.g. silence detection). */
  localInput?: string;
}): Promise<ReRenderResult> {
  const { video, workDir } = params;
  if (!video.playbackUrl) {
    throw new Error(`Video ${video.id} has no playback MP4 to edit`);
  }

  const input = params.localInput ?? path.join(workDir, "playback.mp4");
  if (!params.localInput) {
    await downloadToFile(BUCKETS.processed, video.playbackUrl, input);
  }

  // 1. Backup the current playback MP4 so the edit can be reverted.
  const backupPath = storagePaths.processedBackup(
    video.workspaceId,
    video.id,
    Date.now(),
  );
  await uploadFile(BUCKETS.processed, backupPath, input, "video/mp4", false);
  const inputStat = await fs.stat(input);
  await db.insert(videoAssets).values({
    videoId: video.id,
    type: "original_backup",
    storageBucket: BUCKETS.processed,
    storagePath: backupPath,
    mimeType: "video/mp4",
    sizeBytes: inputStat.size,
    width: video.width,
    height: video.height,
    durationMs: video.durationMs,
    label: "backup",
    status: "ready",
  });

  // 2. Cut.
  const srcProbe = await probe(input);
  const sourceDurationMs = srcProbe.durationMs || video.durationMs || 0;
  const keepRanges = mergeRanges(
    params.keepRanges.map((r) => ({
      startMs: Math.max(0, Math.min(r.startMs, sourceDurationMs)),
      endMs: Math.max(0, Math.min(r.endMs, sourceDurationMs)),
    })),
  );
  if (keepRanges.length === 0) {
    throw new Error("Edit would remove the entire video — refusing to render");
  }

  const output = path.join(workDir, "rerender.mp4");
  await cutKeepRanges({ input, output, keepRanges, hasAudio: srcProbe.hasAudio });
  await uploadFile(BUCKETS.processed, video.playbackUrl, output, "video/mp4", true);

  const outProbe = await probe(output);
  const outStat = await fs.stat(output);

  // 3. Regenerate derived media at the same storage paths.
  const thumbLocal = path.join(workDir, "default.jpg");
  await thumbnail(output, thumbLocal, outProbe.durationMs * 0.25);
  await uploadFile(
    BUCKETS.thumbnails,
    storagePaths.thumbnail(video.workspaceId, video.id, "default.jpg"),
    thumbLocal,
    "image/jpeg",
    true,
  );

  const gifLocal = path.join(workDir, "preview.gif");
  await gifPreview(output, gifLocal, outProbe.durationMs);
  await uploadFile(
    BUCKETS.thumbnails,
    storagePaths.thumbnail(video.workspaceId, video.id, "preview.gif"),
    gifLocal,
    "image/gif",
    true,
  );

  const waveform = await waveformJson(output, outProbe.hasAudio);
  const waveformLocal = path.join(workDir, "waveform.json");
  await fs.writeFile(waveformLocal, JSON.stringify(waveform), "utf8");
  await uploadFile(
    BUCKETS.thumbnails,
    storagePaths.thumbnail(video.workspaceId, video.id, "waveform.json"),
    waveformLocal,
    "application/json",
    true,
  );

  if (video.hlsUrl) {
    const hlsLocal = path.join(workDir, "hls");
    await hlsLadder({
      input: output,
      outDir: hlsLocal,
      maxHeight: outProbe.height,
      sourceWidth: outProbe.width,
      sourceHeight: outProbe.height,
      hasAudio: outProbe.hasAudio,
    });
    await uploadDir(
      BUCKETS.processed,
      storagePaths.hlsDir(video.workspaceId, video.id),
      hlsLocal,
    );
  }

  // 4. Update the videos row.
  await db
    .update(videos)
    .set({
      status: "ready",
      durationMs: outProbe.durationMs,
      sizeBytes: outStat.size,
      width: outProbe.width,
      height: outProbe.height,
      fps: outProbe.fps,
      processingError: null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));

  // Re-transcribe if a ready transcript existed — its timings are now stale.
  const existingTranscript = await findReadyTranscript(video.id);
  if (existingTranscript && env.OPENAI_API_KEY) {
    await enqueueJob({
      videoId: video.id,
      workspaceId: video.workspaceId,
      type: "transcribe",
      inputJson: { autoAi: false },
    });
  }

  return {
    durationMs: outProbe.durationMs,
    sizeBytes: outStat.size,
    removedMs: Math.max(0, sourceDurationMs - outProbe.durationMs),
  };
}
