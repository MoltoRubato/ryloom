import fs from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { notifications, videoAssets, videos } from "@ryloom/db";

import { db } from "../db";
import { env } from "../env";
import {
  fitDimensions,
  gifPreview,
  hlsLadder,
  isMp4Container,
  probe,
  remuxMp4,
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
 * probe → playback MP4 (remux when the source is already H.264/AAC mp4, else
 * transcode) → upload + videos row 'ready' + notification + chained
 * transcribe job IMMEDIATELY → then thumbnail / GIF / waveform (concurrent)
 * → optional HLS ladder (from the original source) → uploads → second videos
 * update with the derived URLs. The video is shareable after one encode.
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
  /** Versions the output keys; stable across retries of the same job. */
  jobId: string;
}): Promise<Record<string, unknown>> {
  const { video, localSource, workDir } = params;
  const step = (message: string) =>
    console.log(`[${new Date().toISOString()}] [video ${video.id}] ${message}`);
  // Output keys carry the job id so a revert/re-transcode can never overwrite
  // a path that an `original_backup` asset row (or a streaming viewer) still
  // references. Retries of the same job reuse the same keys.
  const keyVersion = `j${params.jobId.replace(/-/g, "").slice(0, 8)}`;

  const src = await probe(localSource);
  if (src.width === 0 || src.height === 0) {
    throw new Error("Source file contains no decodable video stream");
  }
  step(
    `probed ${src.width}x${src.height} ${src.durationMs}ms fps=${src.fps} ` +
      `v=${src.videoCodec ?? "?"} a=${src.audioCodec ?? "none"} (${src.formatName})`,
  );

  // --- Playback MP4: remux fast path or transcode ----------------------------
  // Chrome 126+ MediaRecorder records video/mp4;codecs=avc1, so web recordings
  // are commonly already H.264 yuv420p + AAC in mp4 — a -c copy remux takes
  // seconds instead of minutes and loses zero quality.
  const remux =
    isMp4Container(src.formatName) &&
    src.videoCodec === "h264" &&
    src.pixFmt === "yuv420p" &&
    (!src.hasAudio || src.audioCodec === "aac") &&
    src.height <= params.maxHeight;
  const dims = remux
    ? { width: src.width, height: src.height }
    : fitDimensions(src.width, src.height, params.maxHeight);
  const label = `${dims.height}p`;
  const mp4Local = path.join(workDir, `${label}.mp4`);
  if (remux) {
    await remuxMp4(localSource, mp4Local);
    step(`mp4 ${label} remuxed (source already h264/aac mp4)`);
  } else {
    await transcodeMp4({
      input: localSource,
      output: mp4Local,
      maxHeight: params.maxHeight,
      hasAudio: src.hasAudio,
    });
    step(`mp4 ${label} encoded`);
  }

  const out = await probe(mp4Local);
  const durationMs = out.durationMs || src.durationMs;
  const mp4Stat = await fs.stat(mp4Local);

  // --- Early ready: the MP4 alone makes the video shareable ------------------
  const mp4Path = storagePaths.processedMp4(
    video.workspaceId,
    video.id,
    `${label}-${keyVersion}`,
  );
  await uploadFile(BUCKETS.processed, mp4Path, mp4Local, "video/mp4", true);

  // Idempotent across retries: a post-ready failure requeues this job and the
  // retry re-runs from the top.
  await db
    .delete(videoAssets)
    .where(
      and(
        eq(videoAssets.videoId, video.id),
        eq(videoAssets.type, "mp4"),
        eq(videoAssets.storagePath, mp4Path),
      ),
    );
  await db.insert(videoAssets).values({
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
  });
  // hlsUrl goes null until the new ladder lands — a re-transcode must not
  // serve a stale ladder over the fresh MP4. The update is conditional on the
  // video NOT already being 'ready': a retry after a post-ready failure must
  // not re-run the one-shot side effects below, and must not clobber a
  // playbackUrl an edit job swapped in the meantime.
  const readyFlip = await db
    .update(videos)
    .set({
      status: "ready",
      durationMs,
      width: out.width,
      height: out.height,
      fps: out.fps,
      sizeBytes: mp4Stat.size,
      playbackUrl: mp4Path,
      hlsUrl: null,
      processingError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(videos.id, video.id), ne(videos.status, "ready")))
    .returning({ id: videos.id });
  const becameReady = readyFlip.length > 0;
  step(
    becameReady
      ? "video ready (mp4 uploaded) — derived media continues"
      : "video already ready (retry) — skipping one-shot side effects",
  );

  if (becameReady && params.notifyReady) {
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

  // Transcription only needs the uploaded MP4 — enqueue it now so it runs on
  // another worker slot while we render the derived media + HLS ladder.
  if (becameReady && params.chainTranscribe && env.transcribeProvider) {
    await enqueueJob({
      videoId: video.id,
      workspaceId: video.workspaceId,
      type: "transcribe",
      inputJson: { autoAi: params.autoAi },
    });
  }

  // --- Post-ready: derived media + HLS ----------------------------------------
  // A failure past this point fails the JOB but must not un-ready the video —
  // failJob (queue.ts) leaves videos that are already 'ready' untouched.
  let renditions: Awaited<ReturnType<typeof hlsLadder>> = [];
  try {
    const thumbLocal = path.join(workDir, "default.jpg");
    const gifLocal = path.join(workDir, "preview.gif");
    const waveformLocal = path.join(workDir, "waveform.json");
    await Promise.all([
      thumbnail(mp4Local, thumbLocal, durationMs * 0.25),
      gifPreview(mp4Local, gifLocal, durationMs),
      waveformJson(mp4Local, out.hasAudio).then((waveform) =>
        fs.writeFile(waveformLocal, JSON.stringify(waveform), "utf8"),
      ),
    ]);
    step("thumbnail + gif + waveform done");

    const thumbPath = storagePaths.thumbnail(video.workspaceId, video.id, "default.jpg");
    const gifPath = storagePaths.thumbnail(video.workspaceId, video.id, "preview.gif");
    const waveformPath = storagePaths.thumbnail(video.workspaceId, video.id, "waveform.json");
    const hlsMasterPath = storagePaths.hlsMaster(video.workspaceId, video.id, keyVersion);

    // The video went 'ready' before this block, so an edit job can swap
    // playbackUrl while the derived media renders. When that happens the
    // edit's own pipeline regenerates everything from the CUT file — don't
    // publish uncut thumbnails/ladder over it.
    const playbackStillOurs = async () => {
      const row = await db.query.videos.findFirst({
        where: eq(videos.id, video.id),
        columns: { playbackUrl: true },
      });
      return row?.playbackUrl === mp4Path;
    };
    if (!(await playbackStillOurs())) {
      step("playback file changed during derived render (edited) — skipping publish");
      return { label, remuxed: remux, durationMs, derivedSkipped: true };
    }

    await Promise.all([
      uploadFile(BUCKETS.thumbnails, thumbPath, thumbLocal, "image/jpeg", true),
      uploadFile(BUCKETS.thumbnails, gifPath, gifLocal, "image/gif", true),
      uploadFile(BUCKETS.thumbnails, waveformPath, waveformLocal, "application/json", true),
    ]);

    const hlsLocal = path.join(workDir, "hls");
    if (params.hls) {
      // Ladder from the ORIGINAL source — one generation loss, not two. With
      // the remux fast path the top rung is segmented from the MP4 via -c copy.
      renditions = await hlsLadder({
        input: localSource,
        outDir: hlsLocal,
        maxHeight: params.maxHeight,
        sourceWidth: src.width,
        sourceHeight: src.height,
        hasAudio: src.hasAudio,
        copySource: remux ? mp4Local : undefined,
      });
      step(`hls ladder done (${renditions.map((r) => `${r.height}p`).join(",")})`);
      await uploadDir(
        BUCKETS.processed,
        storagePaths.hlsDir(video.workspaceId, video.id, keyVersion),
        hlsLocal,
      );
    }

    // Conditional on the playback file still being this job's output — a
    // concurrent edit's swap (which set hlsUrl null for its own rebuild) must
    // not have a stale uncut ladder published over it.
    const published = await db
      .update(videos)
      .set({
        hlsUrl: params.hls ? hlsMasterPath : null,
        thumbnailUrl: publicUrl(BUCKETS.thumbnails, thumbPath),
        animatedThumbnailUrl: publicUrl(BUCKETS.thumbnails, gifPath),
        waveformUrl: publicUrl(BUCKETS.thumbnails, waveformPath),
        updatedAt: new Date(),
      })
      .where(and(eq(videos.id, video.id), eq(videos.playbackUrl, mp4Path)))
      .returning({ id: videos.id });
    if (published.length === 0) {
      step("playback file changed before publish (edited) — derived URLs not applied");
      return { label, remuxed: remux, durationMs, derivedSkipped: true };
    }

    const assetRows: (typeof videoAssets.$inferInsert)[] = [
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
    // Idempotent across retries (same storage paths every attempt).
    await db.delete(videoAssets).where(
      and(
        eq(videoAssets.videoId, video.id),
        inArray(
          videoAssets.storagePath,
          assetRows.map((r) => r.storagePath),
        ),
      ),
    );
    await db.insert(videoAssets).values(assetRows);
  } catch (error) {
    step(
      `post-ready step failed (video stays ready): ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    );
    throw error;
  }

  return {
    label,
    remuxed: remux,
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
  // The owner can delete a video while its (re)transcode is still queued or
  // retrying — don't burn minutes of encode on bytes nobody can watch.
  if (video.status === "deleted") {
    return { skipped: "video was deleted before transcoding ran" };
  }
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
      jobId: job.id,
    });
  } finally {
    await cleanupDir(workDir);
  }
}
