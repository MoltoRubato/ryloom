import "server-only";

import { Resend } from "resend";

import { env } from "@/env";

/**
 * Email sending is optional: without RESEND_API_KEY we log instead, and the
 * UI always exposes copyable invite links as a fallback.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(`[email skipped] to=${opts.to} subject=${opts.subject}`);
    return { sent: false };
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    console.error("[email error]", error);
    return { sent: false };
  }
  return { sent: true };
}
