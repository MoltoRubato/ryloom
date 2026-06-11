import fs from "node:fs/promises";
import path from "node:path";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  processingJobs,
  transcriptSegments,
  transcripts,
  videoAssets,
  videos,
  type TranscriptWord,
} from "@ryloom/db";

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
import { type ClaimedJob } from "../queue";
import {
  BUCKETS,
  deleteFile,
  deletePrefix,
  downloadToFile,
  publicUrl,
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

export async function findReadyTranscript(videoId: string) {
  return db.query.transcripts.findFirst({
    where: and(eq(transcripts.videoId, videoId), eq(transcripts.status, "ready")),
    orderBy: desc(transcripts.createdAt),
  });
}

// ---------------------------------------------------------------------------
// Caption formatting — mirrors transcribe.ts so remapped captions are
// byte-compatible with freshly transcribed ones.
// ---------------------------------------------------------------------------

type CaptionSegment = { startMs: number; endMs: number; text: string };

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatTimestamp(ms: number, decimalSep: "." | ","): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const frac = clamped % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${decimalSep}${pad(frac, 3)}`;
}

function buildVtt(segments: CaptionSegment[]): string {
  const cues = segments.map(
    (seg, i) =>
      `${i + 1}\n${formatTimestamp(seg.startMs, ".")} --> ${formatTimestamp(seg.endMs, ".")}\n${seg.text}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function buildSrt(segments: CaptionSegment[]): string {
  const cues = segments.map(
    (seg, i) =>
      `${i + 1}\n${formatTimestamp(seg.startMs, ",")} --> ${formatTimestamp(seg.endMs, ",")}\n${seg.text}`,
  );
  return `${cues.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Transcript remap — arithmetic, no re-transcription API call
// ---------------------------------------------------------------------------

/**
 * Raw playback position → position on the cut timeline: time inside removed
 * ranges collapses, everything after shifts left by the cumulative removed
 * milliseconds. Mirrors apps/web/src/lib/edit-ranges.ts rawToVirtualMs.
 */
function rawToVirtualMs(rawMs: number, keeps: MsRange[]): number {
  let virtual = 0;
  for (const r of keeps) {
    if (rawMs <= r.startMs) return virtual;
    if (rawMs < r.endMs) return virtual + (rawMs - r.startMs);
    virtual += r.endMs - r.startMs;
  }
  return virtual;
}

/**
 * Remaps the ready transcript onto the post-cut timeline: segments (and word
 * timestamps) fully inside removed ranges are dropped, partials are clamped
 * to the cut boundaries, and the VTT/SRT caption files are rebuilt and
 * re-uploaded at their existing paths.
 */
async function remapReadyTranscript(params: {
  video: VideoRow;
  keepRanges: MsRange[];
  workDir: string;
}): Promise<{ kept: number; dropped: number } | null> {
  const { video, keepRanges, workDir } = params;
  const transcript = await findReadyTranscript(video.id);
  if (!transcript) return null;

  const segments = await db.query.transcriptSegments.findMany({
    where: eq(transcriptSegments.transcriptId, transcript.id),
    orderBy: asc(transcriptSegments.idx),
  });
  if (segments.length === 0) return null;

  type Remapped = {
    id: string;
    startMs: number;
    endMs: number;
    text: string;
    words: TranscriptWord[] | null;
  };
  const kept: Remapped[] = [];
  const droppedIds: string[] = [];
  for (const seg of segments) {
    const startMs = rawToVirtualMs(seg.startMs, keepRanges);
    const endMs = rawToVirtualMs(seg.endMs, keepRanges);
    if (endMs <= startMs) {
      droppedIds.push(seg.id);
      continue;
    }
    const words = (seg.words ?? [])
      .map((w) => ({
        word: w.word,
        startMs: rawToVirtualMs(w.startMs, keepRanges),
        endMs: rawToVirtualMs(w.endMs, keepRanges),
      }))
      .filter((w) => w.endMs > w.startMs);
    kept.push({
      id: seg.id,
      startMs,
      endMs,
      text: seg.text,
      words: words.length > 0 ? words : null,
    });
  }

  // One transaction — a transient failure mid-loop must not leave the
  // transcript half on the old timeline and half on the new.
  await db.transaction(async (tx) => {
    if (droppedIds.length > 0) {
      await tx
        .delete(transcriptSegments)
        .where(inArray(transcriptSegments.id, droppedIds));
    }
    for (let i = 0; i < kept.length; i++) {
      const seg = kept[i]!;
      await tx
        .update(transcriptSegments)
        .set({ idx: i, startMs: seg.startMs, endMs: seg.endMs, words: seg.words })
        .where(eq(transcriptSegments.id, seg.id));
    }
    await tx
      .update(transcripts)
      .set({
        fullText: kept.map((s) => s.text).join(" ").trim(),
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcript.id));
  });

  // Rebuild captions at the existing paths (same layout as transcribe.ts).
  const vttPath =
    transcript.vttPath ?? storagePaths.captions(video.workspaceId, video.id, "en", "vtt");
  const srtPath =
    transcript.srtPath ?? storagePaths.captions(video.workspaceId, video.id, "en", "srt");
  const vttLocal = path.join(workDir, "remap-en.vtt");
  const srtLocal = path.join(workDir, "remap-en.srt");
  await fs.writeFile(vttLocal, buildVtt(kept), "utf8");
  await fs.writeFile(srtLocal, buildSrt(kept), "utf8");
  await uploadFile(BUCKETS.captions, vttPath, vttLocal, "text/vtt", true);
  await uploadFile(BUCKETS.captions, srtPath, srtLocal, "application/x-subrip", true);

  await db
    .update(videos)
    .set({
      captionsUrl: publicUrl(BUCKETS.captions, vttPath),
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));

  return { kept: kept.length, dropped: droppedIds.length };
}

// ---------------------------------------------------------------------------
// Backup pruning
// ---------------------------------------------------------------------------

const MAX_ORIGINAL_BACKUPS = 3;

/**
 * Caps `original_backup` assets per video at MAX_ORIGINAL_BACKUPS: deletes
 * the older rows AND their R2 objects. An object is only deleted when no
 * surviving backup row references its path and it isn't the live playback
 * file (a revert can make an old backup path live again).
 */
async function pruneOriginalBackups(
  videoId: string,
  livePlaybackPath: string,
): Promise<void> {
  const backups = await db.query.videoAssets.findMany({
    where: and(eq(videoAssets.videoId, videoId), eq(videoAssets.type, "original_backup")),
    orderBy: desc(videoAssets.createdAt),
  });
  const stale = backups.slice(MAX_ORIGINAL_BACKUPS);
  if (stale.length === 0) return;

  const referenced = new Set([
    livePlaybackPath,
    ...backups.slice(0, MAX_ORIGINAL_BACKUPS).map((b) => b.storagePath),
  ]);
  for (const row of stale) {
    if (!referenced.has(row.storagePath)) {
      await deleteFile(row.storageBucket, row.storagePath);
      referenced.add(row.storagePath); // rows can share a path — delete once
    }
    await db.delete(videoAssets).where(eq(videoAssets.id, row.id));
  }
}

// ---------------------------------------------------------------------------
// Derived media regeneration — used post-swap by the flatten engine and by
// the trim job's repair pass when a post-swap failure is retried.
// ---------------------------------------------------------------------------

/** Marker the flatten leaves on its job row when post-swap work fails. */
export type PostSwapMarker = {
  swappedTo?: string;
  rebuildHls?: boolean;
  postSwapIncomplete?: boolean;
};

/**
 * Regenerates thumbnail / GIF / waveform (and optionally the HLS ladder, on
 * a versioned prefix) from a local copy of the playback MP4. All publishes
 * are conditional on `livePlaybackPath` still being the live playbackUrl so
 * a concurrent edit's swap is never clobbered. Idempotent — safe to re-run
 * on a retry.
 */
export async function regenerateDerivedMedia(params: {
  jobId: string;
  video: Pick<VideoRow, "id" | "workspaceId">;
  workDir: string;
  mp4Local: string;
  rebuildHls: boolean;
  livePlaybackPath: string;
  /** Previous ladder's master path — its prefix is deleted once superseded. */
  previousHlsMaster?: string | null;
}): Promise<void> {
  const { video, workDir } = params;
  const step = (message: string) =>
    console.log(`[${new Date().toISOString()}] [video ${video.id}] ${message}`);
  const outProbe = await probe(params.mp4Local);

  const thumbLocal = path.join(workDir, "derived-default.jpg");
  const gifLocal = path.join(workDir, "derived-preview.gif");
  const waveformLocal = path.join(workDir, "derived-waveform.json");
  await Promise.all([
    thumbnail(params.mp4Local, thumbLocal, outProbe.durationMs * 0.25),
    gifPreview(params.mp4Local, gifLocal, outProbe.durationMs),
    waveformJson(params.mp4Local, outProbe.hasAudio).then((waveform) =>
      fs.writeFile(waveformLocal, JSON.stringify(waveform), "utf8"),
    ),
  ]);
  await Promise.all([
    uploadFile(
      BUCKETS.thumbnails,
      storagePaths.thumbnail(video.workspaceId, video.id, "default.jpg"),
      thumbLocal,
      "image/jpeg",
      true,
    ),
    uploadFile(
      BUCKETS.thumbnails,
      storagePaths.thumbnail(video.workspaceId, video.id, "preview.gif"),
      gifLocal,
      "image/gif",
      true,
    ),
    uploadFile(
      BUCKETS.thumbnails,
      storagePaths.thumbnail(video.workspaceId, video.id, "waveform.json"),
      waveformLocal,
      "application/json",
      true,
    ),
  ]);
  step("thumbnail + gif + waveform regenerated");

  if (params.rebuildHls) {
    const hlsVersion = `j${params.jobId.replace(/-/g, "").slice(0, 8)}`;
    const hlsLocal = path.join(workDir, "derived-hls");
    // Ladder from the edited mp4; it is already H.264/AAC yuv420p, so the
    // top rung is segmented from it with -c copy (no extra generation loss).
    await hlsLadder({
      input: params.mp4Local,
      outDir: hlsLocal,
      maxHeight: outProbe.height,
      sourceWidth: outProbe.width,
      sourceHeight: outProbe.height,
      hasAudio: outProbe.hasAudio,
      copySource: params.mp4Local,
    });
    const newHlsDir = storagePaths.hlsDir(video.workspaceId, video.id, hlsVersion);
    await uploadDir(BUCKETS.processed, newHlsDir, hlsLocal);
    const published = await db
      .update(videos)
      .set({
        hlsUrl: storagePaths.hlsMaster(video.workspaceId, video.id, hlsVersion),
        updatedAt: new Date(),
      })
      .where(
        and(eq(videos.id, video.id), eq(videos.playbackUrl, params.livePlaybackPath)),
      )
      .returning({ id: videos.id });
    step(
      published.length > 0
        ? "hls ladder rebuilt from edited mp4"
        : "hls ladder rebuilt but playback changed again — not published",
    );
    if (published.length > 0 && params.previousHlsMaster) {
      const oldPrefix = path.posix.dirname(params.previousHlsMaster);
      if (oldPrefix !== newHlsDir) {
        try {
          await deletePrefix(BUCKETS.processed, oldPrefix);
        } catch {
          // Best-effort — an orphaned ladder prefix only costs storage and is
          // removed with the video's whole prefix on delete.
        }
      }
    }
  }

  await pruneOriginalBackups(video.id, params.livePlaybackPath);
}

// ---------------------------------------------------------------------------
// Flatten engine — shared by trim / silence_removal / filler_removal
// ---------------------------------------------------------------------------

export type ReRenderResult = {
  durationMs: number;
  sizeBytes: number;
  removedMs: number;
};

/**
 * Flattens a pending edit in the background while viewers keep watching:
 *  1. cuts the current playback MP4 (trim/atrim+concat) and uploads it to a
 *     NEW versioned key — the file being served is never overwritten,
 *  2. records the OLD playback path as the `original_backup` asset row
 *     (revertToOriginal uses the latest one; the bytes are already in R2),
 *  3. atomically swaps the videos row: playbackUrl → new path, output probe
 *     dimensions/duration, pendingEditRanges → null, hlsUrl → null (the old
 *     ladder has the old timeline). status is NEVER touched — the video
 *     stays 'ready' throughout,
 *  4. post-swap: remaps the transcript arithmetically, regenerates
 *     thumbnail / GIF / waveform, rebuilds the HLS ladder from the new MP4,
 *     and prunes old backups. A failure here fails the JOB but must not undo
 *     the swap (failJob leaves 'ready' videos untouched).
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
  const step = (message: string) =>
    console.log(`[${new Date().toISOString()}] [video ${video.id}] ${message}`);
  if (!video.playbackUrl) {
    throw new Error(`Video ${video.id} has no playback MP4 to edit`);
  }
  const oldPlaybackPath = video.playbackUrl;

  const input = params.localInput ?? path.join(workDir, "playback.mp4");
  if (!params.localInput) {
    await downloadToFile(BUCKETS.processed, oldPlaybackPath, input);
  }

  // --- Cut to a NEW versioned sibling key — never overwrite the live file ---
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

  const outProbe = await probe(output);
  const outStat = await fs.stat(output);
  const inputStat = await fs.stat(input);

  // e.g. processed/1080p.mp4 → processed/1080p-edit-1718000000000.mp4 (the
  // -edit-<millis> suffix is stripped first so names don't grow per edit).
  const dir = path.posix.dirname(oldPlaybackPath);
  const baseLabel = path.posix
    .basename(oldPlaybackPath, ".mp4")
    .replace(/-edit-\d+$/, "");
  const newPlaybackPath = `${dir}/${baseLabel}-edit-${Date.now()}.mp4`;
  await uploadFile(BUCKETS.processed, newPlaybackPath, output, "video/mp4", true);
  step(`edit rendered → ${newPlaybackPath}`);

  // The old playback file IS the backup — its bytes are already in R2 and
  // nothing overwrites them now that renders go to new paths. No byte-copy.
  await db.insert(videoAssets).values([
    {
      videoId: video.id,
      type: "original_backup",
      storageBucket: BUCKETS.processed,
      storagePath: oldPlaybackPath,
      mimeType: "video/mp4",
      sizeBytes: inputStat.size,
      width: video.width,
      height: video.height,
      durationMs: video.durationMs,
      label: "backup",
      status: "ready",
    },
    {
      videoId: video.id,
      type: "mp4",
      storageBucket: BUCKETS.processed,
      storagePath: newPlaybackPath,
      mimeType: "video/mp4",
      sizeBytes: outStat.size,
      width: outProbe.width,
      height: outProbe.height,
      durationMs: outProbe.durationMs,
      label: baseLabel,
      status: "ready",
    },
  ]);

  // --- Atomic swap: viewers stream the old file until this exact update. ---
  // pendingEditRanges clears in the SAME update playbackUrl changes, so
  // players never apply the cut twice (client-side skip + flattened file).
  // hlsUrl goes null because the old ladder carries the old timeline — the
  // player treats HLS as a fallback only. status is intentionally untouched.
  await db
    .update(videos)
    .set({
      playbackUrl: newPlaybackPath,
      durationMs: outProbe.durationMs,
      width: outProbe.width,
      height: outProbe.height,
      fps: outProbe.fps,
      sizeBytes: outStat.size,
      hlsUrl: null,
      pendingEditRanges: null,
      processingError: null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));
  step("playback swapped to edited mp4 (pending edit cleared)");

  // --- Post-swap: a failure past this point fails the JOB but must not undo
  // the swap — failJob (queue.ts) leaves videos that are 'ready' untouched.
  try {
    const remap = await remapReadyTranscript({ video, keepRanges, workDir });
    if (remap) {
      step(`transcript remapped (${remap.kept} segments kept, ${remap.dropped} dropped)`);
    }

    await regenerateDerivedMedia({
      jobId: params.job.id,
      video,
      workDir,
      mp4Local: output,
      rebuildHls: video.hlsUrl !== null,
      livePlaybackPath: newPlaybackPath,
      previousHlsMaster: video.hlsUrl,
    });
  } catch (error) {
    // Leave a marker so a retry can repair the derived media instead of
    // skipping (the swap already cleared pendingEditRanges, which is the
    // retry's normal "already flattened" signal).
    try {
      const marker: PostSwapMarker = {
        swappedTo: newPlaybackPath,
        rebuildHls: video.hlsUrl !== null,
        postSwapIncomplete: true,
      };
      await db
        .update(processingJobs)
        .set({ outputJson: marker })
        .where(eq(processingJobs.id, params.job.id));
    } catch {
      // Best-effort — without the marker the retry degrades to a skip.
    }
    step(
      `post-swap step failed (edit is already live): ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    );
    throw error;
  }

  return {
    durationMs: outProbe.durationMs,
    sizeBytes: outStat.size,
    removedMs: Math.max(0, sourceDurationMs - outProbe.durationMs),
  };
}
