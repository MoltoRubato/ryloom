import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";
import { z } from "zod";

// Load apps/worker/.env (or whatever cwd the process was started from), then
// fall back to any repo-root .env so local dev "just works" from the monorepo.
config();
config({ path: path.resolve(process.cwd(), "../../.env") });

const envSchema = z.object({
  /** Direct (non-pooled) Postgres connection string. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL (or WORKER_DATABASE_URL) is required"),
  /** Supabase project URL. */
  SUPABASE_URL: z
    .string()
    .url("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) must be a valid URL"),
  /** Service-role key — the worker bypasses RLS for storage + db writes. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  /** Optional — when missing, transcription + AI generation are skipped gracefully. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Chat-completions model id used for AI outputs. */
  AI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  /** Number of jobs processed concurrently. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Scratch directory for downloads + FFmpeg intermediates. */
  TMP_DIR: z.string().min(1).default(path.join(tmpdir(), "ryloom")),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY : undefined,
  AI_MODEL: process.env.AI_MODEL ? process.env.AI_MODEL : undefined,
  WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY
    ? process.env.WORKER_CONCURRENCY
    : undefined,
  TMP_DIR: process.env.TMP_DIR ? process.env.TMP_DIR : undefined,
});

if (!parsed.success) {
  console.error("[worker] Invalid environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
