import "server-only";

import { createDb, type Database } from "@ryloom/db";

import { env } from "@/env";

const globalForDb = globalThis as unknown as { db: Database | undefined };

export const db: Database =
  globalForDb.db ?? createDb(env.DATABASE_URL, { max: env.NODE_ENV === "production" ? 10 : 5 });

if (env.NODE_ENV !== "production") globalForDb.db = db;
