import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle client over postgres.js.
 *
 * Use the Supabase *pooled* connection string (port 6543, `?pgbouncer=true`)
 * from serverless environments (Vercel) and the *direct* connection string
 * (port 5432) from the worker.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, {
    max: options?.max ?? 10,
    // Transaction-mode poolers (Supavisor/pgbouncer) don't support prepared statements.
    prepare: false,
  });
  return drizzle(client, { schema });
}
