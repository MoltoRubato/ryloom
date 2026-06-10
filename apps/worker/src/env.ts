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
  /** Optional — preferred provider for transcription (Whisper) + AI generation. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Optional — Google AI Studio key, used when no OpenAI key is set. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * Chat model id used for AI outputs. Defaults per provider:
   * "gpt-4o-mini" (openai) / "gemini-2.5-flash" (gemini).
   */
  AI_MODEL: z.string().min(1).optional(),
  /** Number of jobs processed concurrently. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Scratch directory for downloads + FFmpeg intermediates. */
  TMP_DIR: z.string().min(1).default(path.join(tmpdir(), "ryloom")),
  /**
   * "true" → drain mode: skip LISTEN, process queued jobs and exit(0) once the
   * queue stays empty for DRAIN_IDLE_EXIT_SECONDS (serverless / Modal).
   */
  WORKER_DRAIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Seconds all slots must stay idle before a drain-mode worker exits. */
  DRAIN_IDLE_EXIT_SECONDS: z.coerce.number().int().min(1).default(10),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY : undefined,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : undefined,
  AI_MODEL: process.env.AI_MODEL ? process.env.AI_MODEL : undefined,
  WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY
    ? process.env.WORKER_CONCURRENCY
    : undefined,
  TMP_DIR: process.env.TMP_DIR ? process.env.TMP_DIR : undefined,
  WORKER_DRAIN: process.env.WORKER_DRAIN ? process.env.WORKER_DRAIN : undefined,
  DRAIN_IDLE_EXIT_SECONDS: process.env.DRAIN_IDLE_EXIT_SECONDS
    ? process.env.DRAIN_IDLE_EXIT_SECONDS
    : undefined,
});

if (!parsed.success) {
  console.error("[worker] Invalid environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const base = parsed.data;

export type AiProvider = "openai" | "gemini";

/**
 * Provider resolution: OpenAI wins when both keys are set (preserves existing
 * behavior), Gemini is the fallback, null disables AI features gracefully.
 */
const llmProvider: AiProvider | null = base.OPENAI_API_KEY
  ? "openai"
  : base.GEMINI_API_KEY
    ? "gemini"
    : null;

/**
 * Transcription uses the same resolution — Whisper requires an OpenAI key,
 * the Gemini audio-understanding path is used otherwise.
 */
const transcribeProvider: AiProvider | null = llmProvider;

/** Provider-aware AI_MODEL default. */
const AI_MODEL =
  base.AI_MODEL ?? (llmProvider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini");

export const env = {
  ...base,
  AI_MODEL,
  llmProvider,
  transcribeProvider,
};
export type Env = typeof env;
