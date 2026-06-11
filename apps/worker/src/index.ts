import fs from "node:fs/promises";
import os from "node:os";

import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
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
import {
  claimJob,
  completeJob,
  failJob,
  heartbeatJob,
  sweepExpiredJobs,
  type ClaimedJob,
  type JobType,
} from "./queue";

const IDLE_POLL_MS = 3_000;
const RETENTION_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const HEARTBEAT_INTERVAL_MS = 60_000; // refresh the job lease (see STALE_LOCK_MINUTES)

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
  // Lease heartbeat: keeps locked_at fresh so other workers don't reclaim a
  // long-running job; stops the moment this process dies, expiring the lease.
  const heartbeat = setInterval(() => {
    void heartbeatJob(job.id, workerId).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
  try {
    const output = await handler(job);
    const kept = await completeJob(job.id, workerId, output);
    if (kept) {
      log(`job ${job.id} (${job.type}) completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    } else {
      log(`job ${job.id} (${job.type}): lease lost mid-run (reclaimed by another worker) — result discarded`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`job ${job.id} (${job.type}) failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message.split("\n")[0] ?? message}`);
    try {
      await failJob(job, error, workerId);
    } catch (failError) {
      log(`job ${job.id}: failJob bookkeeping also failed: ${String(failError)}`);
    }
  } finally {
    clearInterval(heartbeat);
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

// Drain-mode bookkeeping: how many slots are busy, when work was last seen,
// and how many jobs this process has handled.
let activeSlots = 0;
let lastActivityAt = Date.now();
let jobsProcessed = 0;
/** Drain-mode soft deadline: past this, slots stop claiming new jobs. */
let stopClaimingAt: number | null = null;

async function slotLoop(slot: number): Promise<void> {
  log(`slot ${slot} started`);
  while (!shuttingDown) {
    if (stopClaimingAt !== null && Date.now() >= stopClaimingAt) {
      log(`slot ${slot}: max runtime reached — no new claims, letting in-flight work finish`);
      break;
    }
    let job: ClaimedJob | null = null;
    try {
      job = await claimJob(workerId);
    } catch (error) {
      log(`slot ${slot}: claim failed (${String(error)}) — backing off`);
      await waitForWakeOrTimeout(IDLE_POLL_MS);
      continue;
    }
    if (job) {
      lastActivityAt = Date.now();
      activeSlots += 1;
      try {
        await processJob(job);
        jobsProcessed += 1;
      } finally {
        activeSlots -= 1;
        lastActivityAt = Date.now();
      }
      continue; // immediately look for the next job
    }
    await waitForWakeOrTimeout(IDLE_POLL_MS);
  }
  log(`slot ${slot} stopped`);
}

// ---------------------------------------------------------------------------
// Retention self-scheduling
// ---------------------------------------------------------------------------

/**
 * Enqueues a retention_sweep when none is pending. With `onlyIfDue` (drain
 * mode — short-lived processes booting every minute) a sweep that completed
 * within the last interval also counts, so we don't sweep on every boot.
 */
async function ensureRetentionSweepQueued(onlyIfDue = false): Promise<void> {
  try {
    const pending = and(
      eq(processingJobs.type, "retention_sweep"),
      inArray(processingJobs.status, ["queued", "running"]),
    );
    const recentlyCompleted = and(
      eq(processingJobs.type, "retention_sweep"),
      eq(processingJobs.status, "completed"),
      gt(processingJobs.completedAt, new Date(Date.now() - RETENTION_INTERVAL_MS)),
    );
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(processingJobs)
      .where(onlyIfDue ? or(pending, recentlyCompleted) : pending);
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
  const startedAt = Date.now();
  await fs.mkdir(env.TMP_DIR, { recursive: true });
  log(
    `starting — mode=${env.WORKER_DRAIN ? "drain" : "continuous"}, ` +
      `concurrency=${env.WORKER_CONCURRENCY}, tmp=${env.TMP_DIR}, ` +
      `ai=${
        env.llmProvider
          ? `${env.llmProvider}:${env.AI_MODEL}`
          : "disabled (no OPENAI_API_KEY or GEMINI_API_KEY)"
      }`,
  );

  // Dedicated connection for LISTEN — pg_notify('ryloom_jobs', job_id) fires
  // on every processing_jobs insert (see supabase migrations). Polling every
  // 3s remains the fallback if the listener can't connect. Drain mode skips
  // LISTEN entirely: the process is short-lived and polls until it exits.
  let listener: ReturnType<typeof postgres> | null = null;
  if (!env.WORKER_DRAIN) {
    listener = postgres(env.DATABASE_URL, {
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
  }

  // Fail expired 'running' jobs that are out of attempts (dead-worker
  // leftovers); claimJob reclaims expired jobs that still have attempts.
  await sweepExpiredJobs().catch((error) => {
    log(`expired-job sweep failed: ${String(error)}`);
  });

  await ensureRetentionSweepQueued(env.WORKER_DRAIN);
  let retentionTimer: NodeJS.Timeout | null = null;
  let expiredSweepTimer: NodeJS.Timeout | null = null;
  if (!env.WORKER_DRAIN) {
    retentionTimer = setInterval(() => {
      void ensureRetentionSweepQueued();
    }, RETENTION_INTERVAL_MS);
    // Continuous mode boots once, so the boot-time expired-job sweep alone
    // would miss later strandings — re-run it periodically.
    expiredSweepTimer = setInterval(() => {
      void sweepExpiredJobs().catch(() => undefined);
    }, 10 * 60 * 1000);
  }
  if (env.WORKER_DRAIN && env.DRAIN_MAX_RUNTIME_SECONDS) {
    stopClaimingAt = startedAt + env.DRAIN_MAX_RUNTIME_SECONDS * 1000;
  }

  const slots: Promise<void>[] = [];
  for (let i = 0; i < env.WORKER_CONCURRENCY; i++) {
    slots.push(slotLoop(i));
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — finishing in-flight jobs, claiming no new work`);
    if (retentionTimer) clearInterval(retentionTimer);
    if (expiredSweepTimer) clearInterval(expiredSweepTimer);
    wake();
    await Promise.allSettled(slots);
    if (listener) {
      try {
        await listener.end({ timeout: 5 });
      } catch {
        // already closed
      }
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

  if (env.WORKER_DRAIN) {
    // Drain supervisor: once every slot is idle and nothing has been claimable
    // for DRAIN_IDLE_EXIT_SECONDS, stop the slots and exit cleanly.
    const idleExitMs = env.DRAIN_IDLE_EXIT_SECONDS * 1000;
    while (!shuttingDown) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      if (activeSlots === 0 && Date.now() - lastActivityAt >= idleExitMs) {
        shuttingDown = true;
        wake();
      }
    }
    await Promise.allSettled(slots);
    try {
      await db.$client.end({ timeout: 5 });
    } catch {
      // already closed
    }
    log(
      `drain complete — ${jobsProcessed} job(s) processed in ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    process.exit(0);
  }

  await Promise.all(slots);
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] [${workerId}] fatal:`, error);
  process.exit(1);
});
