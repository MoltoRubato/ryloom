import { timingSafeEqual } from "crypto";

import { sql } from "drizzle-orm";

import { env } from "@/env";
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

function tokenValid(provided: string | null): boolean {
  const expected = env.WORKER_BACKSTOP_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  if (!tokenValid(req.headers.get("x-backstop-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const rows = await db.execute(sql`
    SELECT 1 FROM processing_jobs
    WHERE (status = 'queued' AND scheduled_at <= now())
       OR (status = 'running' AND locked_at < now() - interval '15 minutes')
    LIMIT 1
  `);
  const hasWork = rows.length > 0;
  if (hasWork) wakeWorker();
  return Response.json({ hasWork });
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
