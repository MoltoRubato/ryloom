import { env } from "@/env";

/**
 * Internal-tool access: client-safe helpers for the allowed email domain.
 * Server-side enforcement lives in trpc.ts (protectedProcedure), the Next
 * middleware, and the auth callback/confirm routes — these helpers only
 * improve UX by failing fast in forms.
 */

export const ALLOWED_EMAIL_DOMAIN = env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

export const DOMAIN_RESTRICTED = ALLOWED_EMAIL_DOMAIN !== "*";

export function isAllowedEmailDomain(email: string): boolean {
  if (!DOMAIN_RESTRICTED) return true;
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

export const RESTRICTED_DOMAIN_MESSAGE = `Ryloom is an internal tool — sign in with your @${ALLOWED_EMAIL_DOMAIN} account.`;

export const EMAIL_PLACEHOLDER = DOMAIN_RESTRICTED
  ? `you@${ALLOWED_EMAIL_DOMAIN}`
  : "you@company.com";
