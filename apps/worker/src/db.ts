import { createDb } from "@ryloom/db";

import { env } from "./env";

/**
 * Drizzle client over a direct Postgres connection.
 * Sized for the concurrency slots plus a little headroom for chained
 * inserts (notifications, follow-up jobs) issued mid-pipeline.
 */
export const db = createDb(env.DATABASE_URL, {
  max: env.WORKER_CONCURRENCY + 3,
});

export type Db = typeof db;
