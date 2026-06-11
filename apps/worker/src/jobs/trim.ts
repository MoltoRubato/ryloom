import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { processingJobs } from "@ryloom/db";

import { db } from "../db";
import { type ClaimedJob } from "../queue";
import { BUCKETS, downloadToFile } from "../storage";
import {
  cleanupDir,
  createWorkDir,
  getVideoOrThrow,
  mergeRanges,
  regenerateDerivedMedia,
  reRenderWithKeepRanges,
  type PostSwapMarker,
} from "./_shared";

const trimInput = z.object({
  keepRanges: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
});

export async function runTrimJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("trim job is missing videoId");
  const input = trimInput.parse(job.inputJson);
  const video = await getVideoOrThrow(job.videoId);

  // requestTrim persists pendingEditRanges before enqueueing; the flatten's
  // atomic swap clears them. Null here means a retry landed after the swap —
  // the input ranges are on the OLD timeline and must not cut the already
  // flattened file a second time. If the previous attempt failed AFTER the
  // swap it left a marker; finish the derived media it didn't get to.
  // (The transcript remap is not safely re-runnable — the ranges were
  // consumed by the swap — so a remap that failed mid-flight stays stale
  // until the next transcription; everything else repairs cleanly.)
  if (!video.pendingEditRanges || video.pendingEditRanges.length === 0) {
    const jobRow = await db.query.processingJobs.findFirst({
      where: eq(processingJobs.id, job.id),
      columns: { outputJson: true },
    });
    const marker = (jobRow?.outputJson ?? {}) as PostSwapMarker;
    if (
      marker.postSwapIncomplete &&
      marker.swappedTo &&
      marker.swappedTo === video.playbackUrl
    ) {
      const workDir = await createWorkDir(job.id);
      try {
        const mp4Local = path.join(workDir, "playback.mp4");
        await downloadToFile(BUCKETS.processed, video.playbackUrl, mp4Local);
        await regenerateDerivedMedia({
          jobId: job.id,
          video,
          workDir,
          mp4Local,
          rebuildHls: marker.rebuildHls === true,
          livePlaybackPath: video.playbackUrl,
          previousHlsMaster: video.hlsUrl,
        });
        return { repaired: "derived media completed after post-swap retry" };
      } finally {
        await cleanupDir(workDir);
      }
    }
    return { skipped: "edit already flattened (pendingEditRanges cleared)" };
  }

  const keepRanges = mergeRanges(input.keepRanges);
  if (keepRanges.length === 0) {
    throw new Error("Trim request contains no valid keep ranges");
  }

  const workDir = await createWorkDir(job.id);
  try {
    const result = await reRenderWithKeepRanges({ job, video, workDir, keepRanges });
    return {
      keepRanges: keepRanges.length,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes,
      removedMs: result.removedMs,
    };
  } finally {
    await cleanupDir(workDir);
  }
}
