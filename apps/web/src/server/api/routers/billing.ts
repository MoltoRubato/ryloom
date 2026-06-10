import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { subscriptions, workspaces } from "@ryloom/db";

import { env } from "@/env";
import {
  BILLABLE_PLANS,
  getStripe,
  priceIdFor,
  type BillablePlan,
  type BillingInterval,
} from "@/lib/stripe";
import {
  createTRPCRouter,
  protectedProcedure,
  requireMembership,
  writeAuditLog,
  type WorkspaceRole,
} from "@/server/api/trpc";

/** Roles allowed to manage billing for a workspace. */
const BILLING_ROLES: WorkspaceRole[] = ["owner", "admin", "billing_admin"];

function billingReturnUrl(workspaceId: string, suffix = ""): string {
  return `${env.NEXT_PUBLIC_APP_URL}/app/w/${workspaceId}/settings/billing${suffix}`;
}

export const billingRouter = createTRPCRouter({
  getSubscription: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId);

      const subscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.workspaceId, input.workspaceId),
        orderBy: desc(subscriptions.createdAt),
      });

      const prices = {
        pro: {
          monthly: priceIdFor("pro", "monthly") !== null,
          yearly: priceIdFor("pro", "yearly") !== null,
        },
        business: {
          monthly: priceIdFor("business", "monthly") !== null,
          yearly: priceIdFor("business", "yearly") !== null,
        },
        business_ai: {
          monthly: priceIdFor("business_ai", "monthly") !== null,
          yearly: priceIdFor("business_ai", "yearly") !== null,
        },
      };
      const pricesConfigured = BILLABLE_PLANS.some(
        (plan) =>
          priceIdFor(plan, "monthly") !== null || priceIdFor(plan, "yearly") !== null,
      );

      return {
        planId: membership.planId,
        planName: membership.plan.name,
        subscription: subscription ?? null,
        billingEnabled: getStripe() !== null,
        pricesConfigured,
        prices,
        role: membership.role,
      };
    }),

  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        plan: z.enum(["pro", "business", "business_ai"]),
        interval: z.enum(["monthly", "yearly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, BILLING_ROLES);

      const stripe = getStripe();
      if (!stripe) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Billing isn't configured on this instance. A workspace owner can set the plan manually instead.",
        });
      }
      const price = priceIdFor(input.plan as BillablePlan, input.interval as BillingInterval);
      if (!price) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No Stripe price is configured for the ${input.plan} (${input.interval}) plan.`,
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        success_url: billingReturnUrl(input.workspaceId, "?success=1"),
        cancel_url: billingReturnUrl(input.workspaceId, "?canceled=1"),
        metadata: { workspaceId: input.workspaceId, plan: input.plan },
        subscription_data: {
          metadata: { workspaceId: input.workspaceId, plan: input.plan },
        },
        ...(membership.workspace.stripeCustomerId
          ? { customer: membership.workspace.stripeCustomerId }
          : { customer_email: ctx.user.email }),
      });
      if (!session.url) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe didn't return a checkout URL",
        });
      }
      return { url: session.url };
    }),

  createPortalSession: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, BILLING_ROLES);

      const stripe = getStripe();
      if (!stripe) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing isn't configured on this instance.",
        });
      }
      if (!membership.workspace.stripeCustomerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This workspace doesn't have a billing account yet. Subscribe to a plan first.",
        });
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: membership.workspace.stripeCustomerId,
        return_url: billingReturnUrl(input.workspaceId),
      });
      return { url: portal.url };
    }),

  /**
   * Manual plan switch for self-hosters running without Stripe.
   * Enterprise can only be granted this way. Owner only + audit logged.
   */
  setPlanManually: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        plan: z.enum(["free", "pro", "business", "business_ai", "enterprise"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ["owner"]);

      const [updated] = await ctx.db
        .update(workspaces)
        .set({ plan: input.plan, updatedAt: new Date() })
        .where(eq(workspaces.id, input.workspaceId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "workspace.plan_changed",
        targetType: "workspace",
        targetId: input.workspaceId,
        metadata: { from: membership.planId, to: input.plan, via: "manual" },
        headers: ctx.headers,
      });
      return updated;
    }),
});
