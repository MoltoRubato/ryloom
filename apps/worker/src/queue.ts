import { eq, sql } from "drizzle-orm";

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
 * Atomically claims the next runnable job using FOR UPDATE SKIP LOCKED so
 * multiple workers / slots never double-process. Marks it running, stamps
 * lock + start metadata and bumps the attempt counter in the same statement.
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
      WHERE status = 'queued' AND scheduled_at <= now()
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

export async function completeJob(
  jobId: string,
  outputJson: Record<string, unknown> = {},
): Promise<void> {
  await db
    .update(processingJobs)
    .set({
      status: "completed",
      outputJson,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(eq(processingJobs.id, jobId));
}

/**
 * Failure handling: retry with linear backoff (attempts * 60s) until
 * maxAttempts is exhausted, then mark the job failed, flag the video as
 * failed with the error message and notify the owner.
 */
export async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);

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
      .where(eq(processingJobs.id, job.id));
    return;
  }

  await db
    .update(processingJobs)
    .set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    })
    .where(eq(processingJobs.id, job.id));

  if (job.videoId) {
    const video = await db.query.videos.findFirst({
      where: eq(videos.id, job.videoId),
    });
    if (video) {
      await db
        .update(videos)
        .set({
          status: "failed",
          processingError: message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(videos.id, video.id));
      await db.insert(notifications).values({
        userId: video.ownerId,
        type: "video_failed",
        workspaceId: video.workspaceId,
        videoId: video.id,
        title: "Video processing failed",
        body: `"${video.title}" could not be processed. ${job.type.replace(/_/g, " ")} failed after ${job.attempts} attempts.`,
        data: { jobId: job.id, jobType: job.type },
      });
    }
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
