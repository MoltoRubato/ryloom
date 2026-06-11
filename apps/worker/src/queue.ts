import { and, eq, sql } from "drizzle-orm";

import { notifications, processingJobs, videos } from "@ryloom/db";

import { db } from "./db";

export type JobType = (typeof processingJobs.$inferSelect)["type"];

export type ClaimedJob = {
  id: string;
  videoId: string | null;
  workspaceId: string | null;
  type: JobType;
  attempts: number;
  maxAttempts: number;
  inputJson: Record<string, unknown>;
};

/**
 * Lease window for running jobs. processJob heartbeats locked_at every minute
 * while a handler runs, so a 'running' row whose locked_at is older than this
 * belongs to a dead worker (Modal timeout/OOM kill, preemption) and is safe
 * to reclaim. Must be comfortably larger than the heartbeat interval.
 */
export const STALE_LOCK_MINUTES = 15;

/**
 * Atomically claims the next runnable job using FOR UPDATE SKIP LOCKED so
 * multiple workers / slots never double-process. Marks it running, stamps
 * lock + start metadata and bumps the attempt counter in the same statement.
 * Also reclaims 'running' jobs whose lease expired (dead worker) while they
 * still have attempts left — see sweepExpiredJobs for the exhausted ones.
 */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const rows = await db.execute(sql`
    UPDATE processing_jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = now(),
        started_at = now(),
        attempts = attempts + 1
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE (status = 'queued' AND scheduled_at <= now())
         OR (
           status = 'running'
           AND locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES})
           AND attempts < max_attempts
         )
      ORDER BY priority DESC, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, video_id, workspace_id, type, attempts, max_attempts, input_json
  `);

  const row = rows[0] as
    | {
        id: string;
        video_id: string | null;
        workspace_id: string | null;
        type: JobType;
        attempts: number;
        max_attempts: number;
        input_json: Record<string, unknown> | null;
      }
    | undefined;
  if (!row) return null;

  return {
    id: row.id,
    videoId: row.video_id,
    workspaceId: row.workspace_id,
    type: row.type,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    inputJson: row.input_json ?? {},
  };
}

/**
 * Marks a job completed — only if this worker still owns the lease. Returns
 * false when the lease was lost (the job expired and was reclaimed by
 * another worker while we ran); the caller must discard side effects.
 */
export async function completeJob(
  jobId: string,
  lockedBy: string,
  outputJson: Record<string, unknown> = {},
): Promise<boolean> {
  const rows = await db
    .update(processingJobs)
    .set({
      status: "completed",
      outputJson,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.lockedBy, lockedBy)))
    .returning({ id: processingJobs.id });
  return rows.length > 0;
}

/**
 * Job types whose failure means the video has no (new) playable output.
 * Only these flip the video row to 'failed' — a transcribe or ai_generate
 * failure must never brick an already-watchable video.
 */
const VIDEO_CRITICAL_TYPES: ReadonlySet<JobType> = new Set([
  "transcode",
  "trim",
  "silence_removal",
  "filler_removal",
  "stitch",
] as JobType[]);

/**
 * Failure handling: retry with linear backoff (attempts * 60s) until
 * maxAttempts is exhausted, then mark the job failed and notify the owner.
 * Pipeline-critical job types also flag the video as failed; transcript/AI
 * failures leave the video untouched (it is still watchable).
 *
 * When `lockedBy` is given, updates apply only while this worker still owns
 * the lease — a zombie whose job was reclaimed must not clobber the new
 * owner's state. (The boot sweep passes the dead owner's id explicitly.)
 */
export async function failJob(
  job: ClaimedJob,
  error: unknown,
  lockedBy?: string,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
  const owns = lockedBy
    ? and(eq(processingJobs.id, job.id), eq(processingJobs.lockedBy, lockedBy))
    : eq(processingJobs.id, job.id);

  if (job.attempts < job.maxAttempts) {
    const delayMs = job.attempts * 60_000;
    await db
      .update(processingJobs)
      .set({
        status: "queued",
        errorMessage: message,
        lockedBy: null,
        lockedAt: null,
        scheduledAt: new Date(Date.now() + delayMs),
      })
      .where(owns);
    return;
  }

  const updated = await db
    .update(processingJobs)
    .set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    })
    .where(owns)
    .returning({ id: processingJobs.id });
  // Lease lost — another worker owns this job now; no side effects.
  if (updated.length === 0) return;

  if (job.videoId) {
    const video = await db.query.videos.findFirst({
      where: eq(videos.id, job.videoId),
    });
    if (video) {
      const critical = VIDEO_CRITICAL_TYPES.has(job.type);
      if (critical) {
        await db
          .update(videos)
          .set({
            status: "failed",
            processingError: message.slice(0, 1000),
            updatedAt: new Date(),
          })
          .where(eq(videos.id, video.id));
      }
      await db.insert(notifications).values({
        userId: video.ownerId,
        type: "video_failed",
        workspaceId: video.workspaceId,
        videoId: video.id,
        title: critical ? "Video processing failed" : "Transcript / AI step failed",
        body: critical
          ? `"${video.title}" could not be processed. ${job.type.replace(/_/g, " ")} failed after ${job.attempts} attempts.`
          : `${job.type.replace(/_/g, " ")} failed for "${video.title}" after ${job.attempts} attempts — the video itself is still available.`,
        data: { jobId: job.id, jobType: job.type },
      });
    }
  }
}

/** Refreshes a running job's lease — called every minute while a handler runs. */
export async function heartbeatJob(jobId: string, lockedBy: string): Promise<void> {
  await db
    .update(processingJobs)
    .set({ lockedAt: new Date() })
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.status, "running"),
        eq(processingJobs.lockedBy, lockedBy),
      ),
    );
}

/**
 * Marks expired 'running' jobs that are out of attempts as failed (claimJob
 * reclaims the ones with attempts left). Run once at worker boot.
 */
export async function sweepExpiredJobs(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT id, video_id, workspace_id, type, attempts, max_attempts, input_json, locked_by
    FROM processing_jobs
    WHERE status = 'running'
      AND locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES})
      AND attempts >= max_attempts
  `);
  for (const row of rows as unknown as Array<{
    id: string;
    video_id: string | null;
    workspace_id: string | null;
    type: JobType;
    attempts: number;
    max_attempts: number;
    input_json: Record<string, unknown> | null;
    locked_by: string | null;
  }>) {
    await failJob(
      {
        id: row.id,
        videoId: row.video_id,
        workspaceId: row.workspace_id,
        type: row.type,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        inputJson: row.input_json ?? {},
      },
      new Error("Worker died mid-job (lease expired with no attempts left)"),
      // Guard on the dead owner's id so a concurrent reclaim isn't clobbered.
      row.locked_by ?? undefined,
    );
  }
}

/** Enqueues a follow-up job (used for transcribe → ai_generate chaining). */
export async function enqueueJob(params: {
  videoId: string | null;
  workspaceId: string | null;
  type: JobType;
  inputJson?: Record<string, unknown>;
  priority?: number;
}): Promise<void> {
  await db.insert(processingJobs).values({
    videoId: params.videoId,
    workspaceId: params.workspaceId,
    type: params.type,
    inputJson: params.inputJson ?? {},
    priority: params.priority ?? 0,
  });
}
