import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Supabase pooled connection string (port 6543) for serverless.
    DATABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Salt for hashing viewer IPs before storage (privacy).
    IP_HASH_SALT: z.string().min(1).default("ryloom-ip-salt"),
    // Email (optional — invites fall back to copyable links without it)
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    // SCIM bearer tokens are stored hashed in DB; this is a master switch.
    SCIM_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // Worker wake — Cloud Run Jobs (recommended): service-account key
    // (raw JSON or base64) with roles/run.invoker on the worker job, plus the
    // job coordinates. The app starts an execution the moment work is queued.
    GCP_SA_KEY: z.string().optional(),
    CLOUD_RUN_PROJECT: z.string().optional(),
    CLOUD_RUN_REGION: z.string().optional(),
    CLOUD_RUN_JOB: z.string().optional(),
    // Shared secret for /api/worker-backstop (Cloud Scheduler's fallback ping).
    WORKER_BACKSTOP_TOKEN: z.string().optional(),
    // Alternative wake backend: a plain webhook (e.g. the Modal endpoint).
    WORKER_WAKE_URL: z.string().url().optional(),
    WORKER_WAKE_TOKEN: z.string().optional(),
    // Slack app for inline video unfurls (Slack only renders video players
    // for registered apps, never from meta tags) — see docs/slack-app-manifest.yaml.
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_BOT_TOKEN: z.string().optional(),
    // Cloudflare R2 (S3 API) — the video media plane (raw + processed bytes).
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1).default("ryloom-media"),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    // Where the "Download for macOS" button points (e.g. a GitHub release asset).
    // Falls back to the /download instructions page when unset.
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL: z.string().url().optional(),
    // Internal tool: only accounts on this email domain can use the app.
    // Set to "*" to disable the restriction.
    NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN: z
      .string()
      .min(1)
      .default("lyratechnologies.com.au"),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    IP_HASH_SALT: process.env.IP_HASH_SALT,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SCIM_ENABLED: process.env.SCIM_ENABLED,
    GCP_SA_KEY: process.env.GCP_SA_KEY,
    CLOUD_RUN_PROJECT: process.env.CLOUD_RUN_PROJECT,
    CLOUD_RUN_REGION: process.env.CLOUD_RUN_REGION,
    CLOUD_RUN_JOB: process.env.CLOUD_RUN_JOB,
    WORKER_BACKSTOP_TOKEN: process.env.WORKER_BACKSTOP_TOKEN,
    WORKER_WAKE_URL: process.env.WORKER_WAKE_URL,
    WORKER_WAKE_TOKEN: process.env.WORKER_WAKE_TOKEN,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL: process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL,
    NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
