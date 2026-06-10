import fs from "node:fs/promises";
import os from "node:os";

import { and, eq, inArray, sql } from "drizzle-orm";
import postgres from "postgres";

import { processingJobs } from "@ryloom/db";

import { db } from "./db";
import { env } from "./env";
import { runAiGenerateJob } from "./jobs/ai";
import { runFillerRemovalJob } from "./jobs/filler";
import { runRetentionSweepJob } from "./jobs/retention";
import { runSilenceRemovalJob } from "./jobs/silence";
import { runStitchJob } from "./jobs/stitch";
import { runTranscodeJob } from "./jobs/transcode";
import { runTranscribeJob } from "./jobs/transcribe";
import { runTrimJob } from "./jobs/trim";
import { claimJob, completeJob, failJob, type ClaimedJob, type JobType } from "./queue";

const IDLE_POLL_MS = 3_000;
const RETENTION_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h

const workerId = `worker-${os.hostname()}-${process.pid}`;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [${workerId}] ${message}`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type JobHandler = (job: ClaimedJob) => Promise<Record<string, unknown>>;

const handlers: Partial<Record<JobType, JobHandler>> = {
  transcode: runTranscodeJob,
  transcribe: runTranscribeJob,
  ai_generate: runAiGenerateJob,
  trim: runTrimJob,
  silence_removal: runSilenceRemovalJob,
  filler_removal: runFillerRemovalJob,
  stitch: runStitchJob,
  retention_sweep: runRetentionSweepJob,
};

async function processJob(job: ClaimedJob): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    log(`job ${job.id}: no handler for type "${job.type}" — marking failed`);
    await db
      .update(processingJobs)
      .set({
        status: "failed",
        errorMessage: `This worker has no handler for job type "${job.type}"`,
        completedAt: new Date(),
      })
      .where(eq(processingJobs.id, job.id));
    return;
  }

  const startedAt = Date.now();
  log(`job ${job.id} (${job.type}, attempt ${job.attempts}/${job.maxAttempts}) started`);
  try {
    const output = await handler(job);
    await completeJob(job.id, output);
    log(`job ${job.id} (${job.type}) completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`job ${job.id} (${job.type}) failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message.split("\n")[0] ?? message}`);
    try {
      await failJob(job, error);
    } catch (failError) {
      log(`job ${job.id}: failJob bookkeeping also failed: ${String(failError)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Wake signal (LISTEN/NOTIFY with a 3s polling fallback)
// ---------------------------------------------------------------------------

let shuttingDown = false;
let wakeWaiters: Array<() => void> = [];

function wake(): void {
  const waiters = wakeWaiters;
  wakeWaiters = [];
  for (const resolve of waiters) resolve();
}

function waitForWakeOrTimeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const onWake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      wakeWaiters = wakeWaiters.filter((w) => w !== onWake);
      resolve();
    }, ms);
    wakeWaiters.push(onWake);
  });
}

// ---------------------------------------------------------------------------
// Worker slots
// ---------------------------------------------------------------------------

async function slotLoop(slot: number): Promise<void> {
  log(`slot ${slot} started`);
  while (!shuttingDown) {
    let job: ClaimedJob | null = null;
    try {
      job = await claimJob(workerId);
    } catch (error) {
      log(`slot ${slot}: claim failed (${String(error)}) — backing off`);
      await waitForWakeOrTimeout(IDLE_POLL_MS);
      continue;
    }
    if (job) {
      await processJob(job);
      continue; // immediately look for the next job
    }
    await waitForWakeOrTimeout(IDLE_POLL_MS);
  }
  log(`slot ${slot} stopped`);
}

// ---------------------------------------------------------------------------
// Retention self-scheduling
// ---------------------------------------------------------------------------

async function ensureRetentionSweepQueued(): Promise<void> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.type, "retention_sweep"),
          inArray(processingJobs.status, ["queued", "running"]),
        ),
      );
    if (Number(row?.count ?? 0) === 0) {
      await db.insert(processingJobs).values({ type: "retention_sweep", inputJson: {} });
      log("enqueued retention_sweep");
      wake();
    }
  } catch (error) {
    log(`retention self-enqueue failed: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await fs.mkdir(env.TMP_DIR, { recursive: true });
  log(
    `starting — concurrency=${env.WORKER_CONCURRENCY}, tmp=${env.TMP_DIR}, ` +
      `ai=${env.OPENAI_API_KEY ? env.AI_MODEL : "disabled (no OPENAI_API_KEY)"}`,
  );

  // Dedicated connection for LISTEN — pg_notify('ryloom_jobs', job_id) fires
  // on every processing_jobs insert (see supabase migrations). Polling every
  // 3s remains the fallback if the listener can't connect.
  const listener = postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  try {
    await listener.listen("ryloom_jobs", () => wake());
    log("listening on channel ryloom_jobs");
  } catch (error) {
    log(`LISTEN unavailable (${String(error)}) — relying on ${IDLE_POLL_MS}ms polling`);
  }

  await ensureRetentionSweepQueued();
  const retentionTimer = setInterval(() => {
    void ensureRetentionSweepQueued();
  }, RETENTION_INTERVAL_MS);

  const slots: Promise<void>[] = [];
  for (let i = 0; i < env.WORKER_CONCURRENCY; i++) {
    slots.push(slotLoop(i));
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — finishing in-flight jobs, claiming no new work`);
    clearInterval(retentionTimer);
    wake();
    await Promise.allSettled(slots);
    try {
      await listener.end({ timeout: 5 });
    } catch {
      // already closed
    }
    try {
      await db.$client.end({ timeout: 5 });
    } catch {
      // already closed
    }
    log("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await Promise.all(slots);
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] [${workerId}] fatal:`, error);
  process.exit(1);
});
