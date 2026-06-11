import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { videos } from "@ryloom/db";

import { db } from "../db";
import { detectSilences, probe, type MsRange } from "../ffmpeg";
import { type ClaimedJob } from "../queue";
import { BUCKETS, downloadToFile } from "../storage";
import {
  cleanupDir,
  createWorkDir,
  getVideoOrThrow,
  invertToKeepRanges,
  reRenderWithKeepRanges,
} from "./_shared";

const silenceInput = z.object({
  thresholdDb: z.number().min(-60).max(-10).default(-35),
  minSilenceMs: z.number().int().min(300).max(5000).default(900),
  paddingMs: z.number().int().min(0).max(500).default(150),
});

const MIN_KEEP_MS = 250;

export async function runSilenceRemovalJob(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("silence_removal job is missing videoId");
  const input = silenceInput.parse(job.inputJson);
  const video = await getVideoOrThrow(job.videoId);
  if (!video.playbackUrl) throw new Error("Video has no playback MP4 to edit");

  const workDir = await createWorkDir(job.id);
  try {
    const localInput = path.join(workDir, "playback.mp4");
    await downloadToFile(BUCKETS.processed, video.playbackUrl, localInput);

    const info = await probe(localInput);
    if (!info.hasAudio) {
      // No-op exits never touch status or pendingEditRanges — the video
      // stayed 'ready' the whole time and no edit was ever pending.
      return { removedMs: 0, cuts: [], reason: "no_audio" };
    }
    const durationMs = info.durationMs || video.durationMs || 0;
    if (durationMs <= 0) throw new Error("Could not determine video duration");

    const silences = await detectSilences(
      localInput,
      input.thresholdDb,
      input.minSilenceMs / 1000,
      durationMs,
    );

    // Shrink each silence by the padding on both sides so cuts don't clip
    // the surrounding speech.
    const cuts: MsRange[] = silences
      .map((s) => ({
        startMs: s.startMs + input.paddingMs,
        endMs: s.endMs - input.paddingMs,
      }))
      .filter((c) => c.endMs - c.startMs > 0);

    if (cuts.length === 0) {
      return { removedMs: 0, cuts: [] };
    }

    const keepRanges = invertToKeepRanges(cuts, durationMs, MIN_KEEP_MS);
    if (keepRanges.length === 0) {
      // The whole video is silence — refuse rather than produce an empty file.
      return { removedMs: 0, cuts: [], reason: "entire_video_silent" };
    }
    const keptMs = keepRanges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
    if (keptMs >= durationMs) {
      return { removedMs: 0, cuts: [] };
    }

    // Persist the keep ranges FIRST: every player applies pendingEditRanges
    // client-side, so the cuts are visible instantly while the flatten
    // renders in the background. The swap inside reRenderWithKeepRanges
    // clears them atomically with the playbackUrl change.
    await db
      .update(videos)
      .set({ pendingEditRanges: keepRanges, updatedAt: new Date() })
      .where(eq(videos.id, video.id));

    const result = await reRenderWithKeepRanges({
      job,
      video,
      workDir,
      keepRanges,
      localInput,
    });

    return { removedMs: result.removedMs, cuts, durationMs: result.durationMs };
  } finally {
    await cleanupDir(workDir);
  }
}
