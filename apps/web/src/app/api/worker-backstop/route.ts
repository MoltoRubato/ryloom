import { timingSafeEqual } from "crypto";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { processingJobs, recordingSessions, videos } from "@ryloom/db";

import { env } from "@/env";
import { getPlan } from "@/lib/plans";
import { r2ObjectExists } from "@/lib/r2";
import { wakeWorker } from "@/lib/wake-worker";
import { db } from "@/server/db";

/**
 * Worker backstop — Cloud Scheduler pings this every few minutes with the
 * shared token. The web app (which already holds a DB connection) does the
 * cheap "is there work?" check and only then triggers a worker execution.
 *
 * This matters on Cloud Run Jobs: executions bill a 1-minute minimum, so a
 * blind cron that boots the container to find an empty queue would burn the
 * entire free tier on idle polls. One SQL query here costs nothing.
 *
 * The stale-running clause matches STALE_LOCK_MINUTES in the worker's
 * queue.ts — a dead worker's jobs get a new execution to reclaim them.
 */

/** Don't race a finalize the client is still performing itself. */
const ORPHAN_MIN_AGE_MINUTES = 10;
const ORPHAN_SWEEP_LIMIT = 5;

function tokenValid(provided: string | null): boolean {
  const expected = env.WORKER_BACKSTOP_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Finalizes uploads whose client vanished between completeUpload and
 * completeSession: the bytes are fully in R2 (a multipart object only
 * materializes once completed) but the video is wedged in 'uploading' with no
 * processing job — invisible to the queue check below. Mirrors
 * recording.completeSession; the worker's probe step fills in the
 * duration/dimensions the client never got to report.
 */
async function finalizeOrphanedUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MINUTES * 60_000);
  const orphans = await db
    .select({ session: recordingSessions, videoId: videos.id })
    .from(recordingSessions)
    .innerJoin(videos, eq(recordingSessions.videoId, videos.id))
    .where(
      and(
        eq(videos.status, "uploading"),
        inArray(recordingSessions.status, ["created", "recording", "uploading"]),
        lt(recordingSessions.createdAt, cutoff),
      ),
    )
    .limit(ORPHAN_SWEEP_LIMIT);

  let finalized = 0;
  for (const { session, videoId } of orphans) {
    const exists = await r2ObjectExists(session.uploadPath).catch(() => false);
    if (!exists) continue; // upload never completed — leave it for client-side recovery

    // Claim the session exactly like completeSession would; losing the race
    // to a late client retry is fine — whoever flips it enqueues the job.
    const claimed = await db
      .update(recordingSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(recordingSessions.id, session.id),
          inArray(recordingSessions.status, ["created", "recording", "uploading"]),
        ),
      )
      .returning({ id: recordingSessions.id });
    if (claimed.length === 0) continue;

    const plan = getPlan("enterprise");
    await db
      .update(videos)
      .set({
        status: "processing",
        originalFilePath: session.uploadPath,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));
    await db.insert(processingJobs).values({
      videoId,
      workspaceId: session.workspaceId,
      type: "transcode",
      priority: plan.priorityProcessing ? 10 : 0,
      inputJson: {
        sourceBucket: session.uploadBucket,
        sourcePath: session.uploadPath,
        mimeType: session.mimeType,
        maxHeight: plan.maxResolution,
        hls: plan.hlsStreaming,
        transcribe: (plan.transcriptionMinutesPerMonth ?? 1) !== 0,
        autoAi: plan.aiGenerationsPerMonth === null || (plan.aiGenerationsPerMonth ?? 0) > 0,
      },
    });
    finalized += 1;
  }
  return finalized;
}

async function handle(req: Request): Promise<Response> {
  if (!tokenValid(req.headers.get("x-backstop-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const finalized = await finalizeOrphanedUploads().catch(() => 0);
  const rows = await db.execute(sql`
    SELECT 1 FROM processing_jobs
    WHERE (status = 'queued' AND scheduled_at <= now())
       OR (status = 'running' AND locked_at < now() - interval '15 minutes')
    LIMIT 1
  `);
  const hasWork = rows.length > 0 || finalized > 0;
  if (hasWork) wakeWorker();
  return Response.json({ hasWork, finalized });
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
