import path from "node:path";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { videos } from "@ryloom/db";

import { db } from "../db";
import { concatFiles } from "../ffmpeg";
import { type ClaimedJob } from "../queue";
import { BUCKETS, downloadToFile, storagePaths, uploadFile } from "../storage";
import { cleanupDir, createWorkDir, getVideoOrThrow } from "./_shared";
import { processVideoFile } from "./transcode";

const stitchInput = z.object({
  sourceVideoIds: z.array(z.string().uuid()).min(2).max(10),
});

export async function runStitchJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("stitch job is missing videoId");
  const input = stitchInput.parse(job.inputJson);
  const target = await getVideoOrThrow(job.videoId);

  const sourceRows = await db.query.videos.findMany({
    where: inArray(videos.id, input.sourceVideoIds),
  });
  const byId = new Map(sourceRows.map((v) => [v.id, v]));
  const sources = input.sourceVideoIds.map((id) => {
    const v = byId.get(id);
    if (!v) throw new Error(`Source video ${id} not found`);
    if (!v.playbackUrl) throw new Error(`Source video ${id} has no playback MP4`);
    return v;
  });

  const workDir = await createWorkDir(job.id);
  try {
    const localSources: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source?.playbackUrl) continue;
      const local = path.join(workDir, `src-${i}.mp4`);
      await downloadToFile(BUCKETS.processed, source.playbackUrl, local);
      localSources.push(local);
    }

    // Normalize (1080p30 / AAC) + concat.
    const stitched = path.join(workDir, "stitched.mp4");
    await concatFiles(localSources, stitched, workDir);

    // Keep the stitched master as the video's "original" so downloads of the
    // source file work like recorded videos.
    const rawPath = storagePaths.rawRecording(target.workspaceId, target.id, "mp4");
    await uploadFile(BUCKETS.raw, rawPath, stitched, "video/mp4", true);
    await db
      .update(videos)
      .set({ originalFilePath: rawPath, updatedAt: new Date() })
      .where(eq(videos.id, target.id));

    // Run the full ingest pipeline on the stitched file.
    const pipelineOutput = await processVideoFile({
      video: target,
      localSource: stitched,
      workDir,
      maxHeight: 1080, // concatFiles normalizes to 1080p
      hls: false,
      chainTranscribe: true,
      autoAi: true,
      notifyReady: true,
    });

    return { ...pipelineOutput, sources: sources.length };
  } finally {
    await cleanupDir(workDir);
  }
}
