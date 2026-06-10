import type Stripe from "stripe";

import { eq } from "drizzle-orm";

import { subscriptions, workspaces } from "@ryloom/db";

import { env } from "@/env";
import { getStripe, isBillablePlan, planFromPriceId, type BillablePlan } from "@/lib/stripe";
import { db } from "@/server/db";

/**
 * Stripe webhook — keeps the local subscriptions table and workspaces.plan in
 * sync with Stripe. Verified with STRIPE_WEBHOOK_SECRET against the raw body.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type SubscriptionStatus = (typeof subscriptions.$inferInsert)["status"];

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Workspace resolution: subscription metadata first, then customer match.
  let workspaceId = sub.metadata.workspaceId ?? null;
  if (!workspaceId) {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.stripeCustomerId, customerId),
      columns: { id: true },
    });
    workspaceId = workspace?.id ?? null;
  }
  if (!workspaceId) return; // Not one of ours — ignore.

  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  const metadataPlan = sub.metadata.plan;
  const plan: BillablePlan = isBillablePlan(metadataPlan)
    ? metadataPlan
    : (planFromPriceId(priceId) ?? "pro");

  const status = sub.status as SubscriptionStatus;
  const seats = item?.quantity ?? 1;
  const currentPeriodStart = item?.current_period_start
    ? new Date(item.current_period_start * 1000)
    : null;
  const currentPeriodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  await db
    .insert(subscriptions)
    .values({
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      plan,
      status,
      seats,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        stripeCustomerId: customerId,
        stripePriceId: priceId,
        plan,
        status,
        seats,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });

  const effectivePlan = status === "active" || status === "trialing" ? plan : "free";
  await db
    .update(workspaces)
    .set({ plan: effectivePlan, stripeCustomerId: customerId, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

export async function POST(req: Request): Promise<Response> {
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Billing is not configured on this instance" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const workspaceId = session.metadata?.workspaceId;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (workspaceId && customerId) {
        await db
          .update(workspaces)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object);
      break;
    }
    default:
      break;
  }

  return json({ received: true });
}
