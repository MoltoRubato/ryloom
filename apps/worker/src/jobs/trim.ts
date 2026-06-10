import { z } from "zod";

import { type ClaimedJob } from "../queue";
import {
  cleanupDir,
  createWorkDir,
  getVideoOrThrow,
  mergeRanges,
  reRenderWithKeepRanges,
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
