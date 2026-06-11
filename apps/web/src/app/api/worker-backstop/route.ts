import { timingSafeEqual } from "crypto";

import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

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
 * Heals recordings that died partway through the finalize sequence
 * (completeUpload → session 'completed' → video 'processing' → job insert).
 * A crash at any point leaves a video wedged with no queued job — invisible
 * to the queue check below. Three shapes, all sharing one invariant: it is
 * only safe to process when the raw bytes are provably in R2.
 *
 *  - video 'uploading' + session unfinished → prove bytes via R2 HEAD
 *    (a multipart object only materializes once completed), then finalize.
 *  - video 'uploading' + session 'completed' → completeSession crashed after
 *    its first write; session state already proves the bytes.
 *  - video 'processing' + no transcode job ever inserted → the job insert
 *    was lost; re-insert it. (Edited videos keep their original completed
 *    transcode row, so they never match.)
 *
 * Mirrors recording.completeSession; the worker's probe fills in the
 * duration/dimensions the client never got to report.
 */
async function finalizeOrphanedUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MINUTES * 60_000);
  const noTranscodeJob = sql`NOT EXISTS (
    SELECT 1 FROM processing_jobs pj
    WHERE pj.video_id = ${videos.id} AND pj.type = 'transcode'
  )`;
  const orphans = await db
    .select({ session: recordingSessions, videoId: videos.id })
    .from(recordingSessions)
    .innerJoin(videos, eq(recordingSessions.videoId, videos.id))
    .where(
      and(
        ne(recordingSessions.status, "canceled"),
        lt(recordingSessions.createdAt, cutoff),
        or(
          eq(videos.status, "uploading"),
          and(eq(videos.status, "processing"), noTranscodeJob),
        ),
      ),
    )
    .limit(ORPHAN_SWEEP_LIMIT);

  let finalized = 0;
  for (const { session, videoId } of orphans) {
    // A 'completed' session already proves completeUpload finished; anything
    // earlier needs the object itself as evidence.
    const bytesLanded =
      session.status === "completed" ||
      (await r2ObjectExists(session.uploadPath).catch(() => false));
    if (!bytesLanded) continue; // upload never completed — leave it for client-side recovery

    // Claim the session exactly like completeSession would; losing the race
    // to a late client retry is fine — whoever flips it enqueues the job.
    if (session.status !== "completed") {
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
    }

    const plan = getPlan("enterprise");
    await db
      .update(videos)
      .set({
        status: "processing",
        originalFilePath: session.uploadPath,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));
    // Guarded insert: never double-queue if a transcode job snuck in since
    // the candidate query (client retry, overlapping tick).
    await db.execute(sql`
      INSERT INTO processing_jobs (video_id, workspace_id, type, priority, input_json)
      SELECT ${videoId}, ${session.workspaceId}, 'transcode', ${plan.priorityProcessing ? 10 : 0},
             ${JSON.stringify({
               sourceBucket: session.uploadBucket,
               sourcePath: session.uploadPath,
               mimeType: session.mimeType,
               maxHeight: plan.maxResolution,
               hls: plan.hlsStreaming,
               transcribe: (plan.transcriptionMinutesPerMonth ?? 1) !== 0,
               autoAi:
                 plan.aiGenerationsPerMonth === null || (plan.aiGenerationsPerMonth ?? 0) > 0,
             })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM processing_jobs pj
        WHERE pj.video_id = ${videoId} AND pj.type = 'transcode'
          AND pj.status IN ('queued', 'running')
      )
    `);
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
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
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
