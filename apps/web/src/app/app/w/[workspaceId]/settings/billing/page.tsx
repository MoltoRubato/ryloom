"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  AlertTriangle,
  Check,
  CreditCard,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPlan, PLAN_ORDER, type PlanId } from "@/lib/plans";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/trpc/react";

type BillingInterval = "monthly" | "yearly";

const PLAN_CARDS: {
  id: "pro" | "business" | "business_ai";
  monthly: number;
  yearly: number;
  tagline: string;
  features: string[];
}[] = [
  {
    id: "pro",
    monthly: 12,
    yearly: 10,
    tagline: "For individuals who record a lot",
    features: [
      "Unlimited videos & recording length",
      "1080p recording quality",
      "Custom thumbnails & expiring links",
      "Viewer insights & engagement graph",
      "25 AI generations / month",
    ],
  },
  {
    id: "business",
    monthly: 20,
    yearly: 16,
    tagline: "For teams sharing video at work",
    features: [
      "Everything in Pro, in 4K",
      "Team spaces & custom branding",
      "Viewer email watermarking",
      "Silence removal & CSV exports",
      "Slack, Jira, GitHub integrations",
    ],
  },
  {
    id: "business_ai",
    monthly: 25,
    yearly: 20,
    tagline: "AI workflows on top of Business",
    features: [
      "Everything in Business",
      "Unlimited AI generations",
      "Video → doc, ticket & recap email",
      "Filler-word removal",
      "Edit video by transcript",
    ],
  },
];

function UsageBar({
  label,
  used,
  limit,
  formatValue,
}: {
  label: string;
  used: number;
  limit: number | null;
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());
  const pct =
    limit === null || limit === 0
      ? null
      : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {fmt(used)}
          {limit !== null ? ` / ${fmt(limit)}` : " · Unlimited"}
        </span>
      </div>
      {pct !== null ? (
        <Progress
          value={pct}
          className={cn(pct >= 90 && "[&>*]:bg-destructive")}
        />
      ) : (
        <Progress value={used > 0 ? 100 : 0} className="opacity-30" />
      )}
    </div>
  );
}

function BillingPageInner() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const utils = api.useUtils();

  const [interval, setBillingInterval] = useState<BillingInterval>("monthly");

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const subscriptionQuery = api.billing.getSubscription.useQuery({ workspaceId });

  const role = workspaceQuery.data?.role;
  const isOwner = role === "owner";
  const canBill = role === "owner" || role === "billing_admin";
  const canSeeUsage =
    role === "owner" || role === "admin" || role === "billing_admin";

  const usageQuery = api.admin.getUsage.useQuery(
    { workspaceId },
    { enabled: canSeeUsage, retry: false },
  );

  const successToastFired = useRef(false);
  useEffect(() => {
    if (searchParams.get("success") === "1" && !successToastFired.current) {
      successToastFired.current = true;
      toast.success("Subscription updated — welcome aboard!");
      void utils.billing.getSubscription.invalidate({ workspaceId });
      void utils.workspace.get.invalidate({ workspaceId });
      router.replace(pathname);
    }
  }, [searchParams, router, pathname, utils, workspaceId]);

  const createCheckout = api.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => toast.error(err.message),
  });

  const createPortal = api.billing.createPortalSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => toast.error(err.message),
  });

  const setPlanManually = api.billing.setPlanManually.useMutation({
    onSuccess: async () => {
      toast.success("Plan updated");
      await utils.workspace.get.invalidate({ workspaceId });
      await utils.billing.getSubscription.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const [manualPlan, setManualPlan] = useState<PlanId | "">("");

  if (workspaceQuery.isLoading || subscriptionQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const planId = (workspaceQuery.data?.planId ?? "free") as PlanId;
  const plan = getPlan(planId);

  const subInfo = subscriptionQuery.data;
  const subscription = subInfo?.subscription ?? null;
  const billingEnabled = subInfo?.billingEnabled ?? false;

  const renewalDate = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;

  const usageData = usageQuery.data;
  const currentUsage =
    usageData?.usage.find((r) => r.period === usageData.currentPeriod) ??
    usageData?.usage[0] ??
    null;
  const totalVideos = usageData?.videoCount ?? 0;
  const totalStorage = usageData?.storageBytes ?? 0;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Current plan"
        description="Your workspace plan and renewal details."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold text-foreground">
                {plan.name}
              </span>
              <Badge
                variant={
                  planId === "free"
                    ? "secondary"
                    : subscription && subscription.status !== "active"
                      ? "destructive"
                      : "default"
                }
              >
                {planId === "free"
                  ? "Free"
                  : subscription && subscription.status !== "active"
                    ? subscription.status.replace(/_/g, " ")
                    : "Active"}
              </Badge>
            </div>
            {renewalDate && (
              <p className="text-sm text-muted-foreground">
                {subscription?.cancelAtPeriodEnd
                  ? `Cancels on ${format(renewalDate, "d MMM yyyy")} — you keep ${plan.name} until then.`
                  : `Renews on ${format(renewalDate, "d MMM yyyy")}.`}
              </p>
            )}
            {!renewalDate && planId === "free" && (
              <p className="text-sm text-muted-foreground">
                You&apos;re on the free Starter plan. Upgrade for unlimited videos and
                recording time.
              </p>
            )}
            {subscription?.cancelAtPeriodEnd && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="size-4" />
                This subscription is set to cancel at the end of the period.
              </p>
            )}
          </div>
          {billingEnabled && subscription && (
            <Button
              variant="outline"
              disabled={!canBill || createPortal.isPending}
              onClick={() => createPortal.mutate({ workspaceId })}
            >
              {createPortal.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Manage subscription
            </Button>
          )}
        </div>
      </SettingsSection>

      {billingEnabled ? (
        <SettingsSection
          title="Plans"
          description={
            canBill
              ? "Switch plans any time — changes are prorated by Stripe."
              : "Only the workspace owner or a billing admin can change the plan."
          }
        >
          <div className="mb-5 flex justify-center">
            <Tabs
              value={interval}
              onValueChange={(v) => setBillingInterval(v as BillingInterval)}
            >
              <TabsList>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="yearly">
                  Yearly
                  <Badge variant="secondary" className="ml-1.5">
                    Save 20%
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PLAN_CARDS.map((card) => {
              const cardPlan = getPlan(card.id);
              const isCurrent = planId === card.id;
              const isDowngrade =
                PLAN_ORDER.indexOf(card.id) < PLAN_ORDER.indexOf(planId);
              const price = interval === "monthly" ? card.monthly : card.yearly;
              return (
                <div
                  key={card.id}
                  className={cn(
                    "flex flex-col rounded-xl border border-border bg-background p-5 shadow-sm",
                    isCurrent && "border-primary ring-1 ring-primary",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-foreground">
                      {cardPlan.name}
                    </h3>
                    {isCurrent && <Badge>Current</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {card.tagline}
                  </p>
                  <p className="mt-4">
                    <span className="text-3xl font-bold text-foreground">
                      ${price}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      / creator / month
                      {interval === "yearly" ? ", billed yearly" : ""}
                    </span>
                  </p>
                  <ul className="mt-4 flex-1 space-y-2">
                    {card.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-sm text-foreground"
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-5 w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={
                      isCurrent || !canBill || createCheckout.isPending
                    }
                    onClick={() =>
                      createCheckout.mutate({
                        workspaceId,
                        plan: card.id,
                        interval,
                      })
                    }
                  >
                    {createCheckout.isPending && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {isCurrent
                      ? "Current plan"
                      : isDowngrade
                        ? `Switch to ${cardPlan.name}`
                        : `Upgrade to ${cardPlan.name}`}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Need SSO, SCIM, audit logs, or retention policies?{" "}
            <a
              href="mailto:sales@ryloom.com"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Talk to us about Enterprise
              <ExternalLink className="ml-0.5 inline size-3" />
            </a>
          </p>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Plans"
          description="Stripe is not configured for this deployment."
        >
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Stripe isn&apos;t configured, so self-serve checkout is disabled. Add
                the <code className="rounded bg-muted px-1 font-mono text-xs">STRIPE_*</code>{" "}
                environment variables to enable billing.
              </span>
            </p>
          </div>

          {isOwner && (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-foreground">
                Set plan manually
                <Badge variant="secondary" className="ml-2 gap-1">
                  <Sparkles className="size-3" />
                  Self-hosters
                </Badge>
              </p>
              <p className="text-sm text-muted-foreground">
                As the workspace owner of a self-hosted deployment you can assign
                a plan directly. This is also the only way to enable Enterprise.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={manualPlan || planId}
                  onValueChange={(v) => setManualPlan(v as PlanId)}
                >
                  <SelectTrigger className="sm:w-56" aria-label="Manual plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_ORDER.map((id) => (
                      <SelectItem key={id} value={id}>
                        {getPlan(id).name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={
                    setPlanManually.isPending ||
                    manualPlan === "" ||
                    manualPlan === planId
                  }
                  onClick={() => {
                    if (manualPlan) {
                      setPlanManually.mutate({ workspaceId, plan: manualPlan });
                    }
                  }}
                >
                  {setPlanManually.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Apply plan
                </Button>
              </div>
            </div>
          )}
        </SettingsSection>
      )}

      {canSeeUsage && !usageQuery.isError && (
        <SettingsSection
          title="Usage this month"
          description={`Compared against the ${plan.name} plan limits.`}
        >
          {usageQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
              <UsageBar
                label="Videos"
                used={totalVideos}
                limit={plan.maxVideos}
              />
              <UsageBar
                label="AI generations"
                used={currentUsage?.aiGenerations ?? 0}
                limit={plan.aiGenerationsPerMonth}
              />
              <UsageBar
                label="Storage"
                used={totalStorage}
                limit={null}
                formatValue={formatBytes}
              />
              <UsageBar
                label="Transcription minutes"
                used={Math.round((currentUsage?.transcriptionSeconds ?? 0) / 60)}
                limit={plan.transcriptionMinutesPerMonth}
              />
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  );
}

export default function BillingSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}
