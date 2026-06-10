import "server-only";

import Stripe from "stripe";

import { env } from "@/env";

/**
 * Stripe is optional — self-hosters without STRIPE_SECRET_KEY get a null
 * client and the billing router degrades gracefully (manual plan setting
 * stays available to workspace owners).
 */

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  stripeSingleton ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripeSingleton;
}

export type BillablePlan = "pro" | "business" | "business_ai";
export type BillingInterval = "monthly" | "yearly";

export const BILLABLE_PLANS: BillablePlan[] = ["pro", "business", "business_ai"];

/** Resolves the Stripe price id for a plan/interval from env, or null when unset. */
export function priceIdFor(plan: BillablePlan, interval: BillingInterval): string | null {
  const prices: Record<BillablePlan, Record<BillingInterval, string | undefined>> = {
    pro: {
      monthly: env.STRIPE_PRICE_PRO_MONTHLY,
      yearly: env.STRIPE_PRICE_PRO_YEARLY,
    },
    business: {
      monthly: env.STRIPE_PRICE_BUSINESS_MONTHLY,
      yearly: env.STRIPE_PRICE_BUSINESS_YEARLY,
    },
    business_ai: {
      monthly: env.STRIPE_PRICE_BUSINESS_AI_MONTHLY,
      yearly: env.STRIPE_PRICE_BUSINESS_AI_YEARLY,
    },
  };
  return prices[plan][interval] ?? null;
}

/** Reverse lookup: which plan does a Stripe price id belong to? */
export function planFromPriceId(priceId: string | null | undefined): BillablePlan | null {
  if (!priceId) return null;
  for (const plan of BILLABLE_PLANS) {
    if (priceIdFor(plan, "monthly") === priceId || priceIdFor(plan, "yearly") === priceId) {
      return plan;
    }
  }
  return null;
}

export function isBillablePlan(value: unknown): value is BillablePlan {
  return value === "pro" || value === "business" || value === "business_ai";
}
