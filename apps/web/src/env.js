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
    // Stripe (optional — billing is disabled gracefully without it)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_MONTHLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_YEARLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_AI_MONTHLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_AI_YEARLY: z.string().optional(),
    // Email (optional — invites fall back to copyable links without it)
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    // SCIM bearer tokens are stored hashed in DB; this signs nothing but
    // keeps a master switch for the SCIM API.
    SCIM_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    // Where the "Download for macOS" button points (e.g. a GitHub release asset).
    // Falls back to the /download instructions page when unset.
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    IP_HASH_SALT: process.env.IP_HASH_SALT,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
    STRIPE_PRICE_BUSINESS_MONTHLY: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    STRIPE_PRICE_BUSINESS_YEARLY: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
    STRIPE_PRICE_BUSINESS_AI_MONTHLY: process.env.STRIPE_PRICE_BUSINESS_AI_MONTHLY,
    STRIPE_PRICE_BUSINESS_AI_YEARLY: process.env.STRIPE_PRICE_BUSINESS_AI_YEARLY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SCIM_ENABLED: process.env.SCIM_ENABLED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL: process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
