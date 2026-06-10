"use client";

import { Check, ChevronDown, Minus } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FadeIn } from "@/components/marketing/motion-primitives";
import { PLAN_ORDER, PLANS, type PlanId, type PlanLimits } from "@/lib/plans";
import { cn } from "@/lib/utils";

type Interval = "monthly" | "yearly";

/** Per-creator pricing in USD. null = custom (Enterprise). */
const PRICE_TABLE: Record<PlanId, { monthly: number; yearly: number } | null> =
  {
    free: { monthly: 0, yearly: 0 },
    pro: { monthly: 15, yearly: 12.5 },
    business: { monthly: 24, yearly: 20 },
    business_ai: { monthly: 30, yearly: 25 },
    enterprise: null,
  };

const PLAN_META: Record<
  PlanId,
  {
    description: string;
    highlights: string[];
    cta: { label: string; href: string };
    popular?: boolean;
  }
> = {
  free: {
    description: "Try async video on for size.",
    highlights: [
      "Up to 25 videos",
      "5-minute recordings",
      "720p playback",
      "60 transcription min/mo",
      "5 AI generations/mo",
    ],
    cta: { label: "Get started free", href: "/signup" },
  },
  pro: {
    description: "For individuals who record daily.",
    highlights: [
      "Unlimited videos & length",
      "1080p with adaptive streaming",
      "Viewer insights & engagement graph",
      "Password & expiring links",
      "Folders & custom thumbnails",
    ],
    cta: { label: "Start with Pro", href: "/signup" },
  },
  business: {
    description: "For teams that run on video.",
    highlights: [
      "Everything in Pro",
      "4K playback",
      "Team spaces & custom branding",
      "Domain restriction & viewer watermark",
      "Silence removal & CSV export",
    ],
    cta: { label: "Start with Business", href: "/signup" },
    popular: true,
  },
  business_ai: {
    description: "Business, plus the full AI suite.",
    highlights: [
      "Everything in Business",
      "Unlimited AI generations",
      "Video → doc, ticket, PR & recap",
      "Filler-word removal",
      "Edit video by transcript",
    ],
    cta: { label: "Start with Business + AI", href: "/signup" },
  },
  enterprise: {
    description: "Compliance, control, and scale.",
    highlights: [
      "Everything in Business + AI",
      "SAML SSO & SCIM provisioning",
      "Audit logs & exports",
      "Retention policies & legal hold",
      "Advanced admin roles",
    ],
    cta: { label: "Contact us", href: "/enterprise" },
  },
};

function formatPrice(value: number): string {
  return value % 1 === 0 ? `$${value}` : `$${value.toFixed(2)}`;
}

function resolutionLabel(p: PlanLimits): string {
  return p.maxResolution === 2160 ? "4K" : `${p.maxResolution}p`;
}

type ComparisonRow = {
  label: string;
  value: (p: PlanLimits) => boolean | string;
};

type ComparisonGroup = { title: string; rows: ComparisonRow[] };

const COMPARISON_GROUPS: ComparisonGroup[] = [
  {
    title: "Recording & playback",
    rows: [
      {
        label: "Videos",
        value: (p) => (p.maxVideos === null ? "Unlimited" : `${p.maxVideos}`),
      },
      {
        label: "Recording length",
        value: (p) =>
          p.maxRecordingMinutes === null
            ? "Unlimited"
            : `${p.maxRecordingMinutes} min`,
      },
      { label: "Max resolution", value: resolutionLabel },
      { label: "Adaptive streaming (HLS)", value: (p) => p.hlsStreaming },
      { label: "Custom thumbnails", value: (p) => p.customThumbnails },
      { label: "Priority processing", value: (p) => p.priorityProcessing },
    ],
  },
  {
    title: "Sharing & privacy",
    rows: [
      { label: "Password protection", value: (p) => p.passwordProtection },
      { label: "Expiring links", value: (p) => p.expiringLinks },
      { label: "Domain restriction", value: (p) => p.domainRestriction },
      {
        label: "Viewer email watermark",
        value: (p) => p.watermarkViewerEmail,
      },
      { label: "Disable downloads", value: (p) => p.disableDownloads },
      { label: "Custom branding", value: (p) => p.customBranding },
      {
        label: "Remove Ryloom branding",
        value: (p) => p.removeRyloomBranding,
      },
    ],
  },
  {
    title: "Organization",
    rows: [
      { label: "Folders", value: (p) => p.folders },
      { label: "Team spaces", value: (p) => p.teamSpaces },
      {
        label: "Seats",
        value: (p) => (p.maxSeats === null ? "Unlimited" : `Up to ${p.maxSeats}`),
      },
    ],
  },
  {
    title: "Insights",
    rows: [
      { label: "Viewer insights", value: (p) => p.viewerInsights },
      { label: "Engagement graph", value: (p) => p.engagementGraph },
      { label: "Analytics CSV export", value: (p) => p.exportAnalyticsCsv },
    ],
  },
  {
    title: "AI & editing",
    rows: [
      {
        label: "Transcription",
        value: (p) =>
          p.transcriptionMinutesPerMonth === null
            ? "Unlimited"
            : `${p.transcriptionMinutesPerMonth} min/mo`,
      },
      {
        label: "AI generations",
        value: (p) =>
          p.aiGenerationsPerMonth === null
            ? "Unlimited"
            : p.aiGenerationsPerMonth === 0
              ? false
              : `${p.aiGenerationsPerMonth}/mo`,
      },
      {
        label: "AI workflows (doc, ticket, PR…)",
        value: (p) => p.aiWorkflows,
      },
      { label: "Trim & stitch", value: (p) => p.trimStitch },
      { label: "Silence removal", value: (p) => p.silenceRemoval },
      { label: "Filler-word removal", value: (p) => p.fillerWordRemoval },
      { label: "Edit by transcript", value: (p) => p.editByTranscript },
      { label: "Integrations", value: (p) => p.integrations },
    ],
  },
  {
    title: "Enterprise & admin",
    rows: [
      { label: "SSO (SAML)", value: (p) => p.sso },
      { label: "SCIM provisioning", value: (p) => p.scim },
      { label: "Audit logs", value: (p) => p.auditLogs },
      {
        label: "Retention policies & legal hold",
        value: (p) => p.retentionPolicies,
      },
      { label: "Advanced admin roles", value: (p) => p.advancedAdminRoles },
    ],
  },
];

const FAQ_ITEMS = [
  {
    question: "Is the Starter plan really free?",
    answer:
      "Yes — free forever, no credit card required. You get up to 25 videos at 720p with 5-minute recordings, 60 transcription minutes, and 5 AI generations every month. When you hit a limit, your existing videos keep working; you just can't record past it until you upgrade.",
  },
  {
    question: "What counts as a 'creator'?",
    answer:
      "A creator is anyone in your workspace who records or uploads videos. Viewers — people who only watch, comment, and react — are always free and unlimited on every plan, including Starter.",
  },
  {
    question: "What's the difference between Business and Business + AI?",
    answer:
      "Business + AI includes everything in Business and unlocks the full AI suite: unlimited AI generations, video-to-doc workflows (bug reports, SOPs, PR descriptions, recap emails and more), filler-word removal, and editing your video by editing its transcript.",
  },
  {
    question: "Can I switch between monthly and yearly billing?",
    answer:
      "Anytime. Yearly billing saves roughly 17% (for example, Business is $20 instead of $24 per creator per month). Switching mid-cycle is prorated automatically through Stripe — no emails, no support tickets.",
  },
  {
    question: "What happens to my videos if I downgrade?",
    answer:
      "Nothing is deleted. All existing videos remain watchable and shareable. Features above your new plan — like 4K renditions, team spaces, or AI workflows — simply stop being available for new recordings until you upgrade again.",
  },
  {
    question: "How do I get the Enterprise plan?",
    answer:
      "Enterprise is sold directly so we can set up SAML SSO, SCIM provisioning, retention policies, and audit exports with your IT team. Head to the Enterprise page or email sales@ryloom.com and we'll get you a quote within one business day.",
  },
] as const;

function ComparisonCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <span className="inline-flex" aria-label="Included">
        <Check className="size-4 text-primary" />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex" aria-label="Not included">
        <Minus className="size-4 text-muted-foreground/40" />
      </span>
    );
  }
  return <span className="text-sm text-foreground">{value}</span>;
}

export function PricingContent() {
  const [interval, setInterval] = useState<Interval>("yearly");

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10"
      >
        <div className="mx-auto h-80 w-[48rem] max-w-full rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        {/* Header */}
        <FadeIn className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Pricing
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Pay for creators. Viewers are free.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Every plan includes unlimited viewers, transcripts, comments, and
            share links. Upgrade for longer recordings, deeper analytics, and
            the AI suite.
          </p>
        </FadeIn>

        {/* Interval toggle */}
        <FadeIn delay={0.1} className="mt-9 flex justify-center">
          <div
            className="inline-flex items-center rounded-full border border-border bg-card p-1 shadow-sm"
            role="group"
            aria-label="Billing interval"
          >
            <button
              type="button"
              onClick={() => setInterval("monthly")}
              aria-pressed={interval === "monthly"}
              className={cn(
                "rounded-full px-5 py-2 text-sm font-semibold transition-colors",
                interval === "monthly"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval("yearly")}
              aria-pressed={interval === "yearly"}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-colors",
                interval === "yearly"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Yearly
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  interval === "yearly"
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-accent text-accent-foreground",
                )}
              >
                Save ~17%
              </span>
            </button>
          </div>
        </FadeIn>

        {/* Plan cards */}
        <FadeIn delay={0.15} y={32} className="mt-12">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
            {PLAN_ORDER.map((planId) => {
              const plan = PLANS[planId];
              const meta = PLAN_META[planId];
              const price = PRICE_TABLE[planId];
              return (
                <div
                  key={planId}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm",
                    meta.popular
                      ? "border-primary shadow-xl shadow-primary/10"
                      : "border-border",
                  )}
                >
                  {meta.popular ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                      Most popular
                    </span>
                  ) : null}
                  <h2 className="text-base font-semibold text-foreground">
                    {plan.name}
                  </h2>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                    {meta.description}
                  </p>
                  <div className="mt-4">
                    {price ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold tracking-tight text-foreground">
                            {formatPrice(price[interval])}
                          </span>
                          {price[interval] > 0 ? (
                            <span className="text-sm text-muted-foreground">
                              /mo
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {price[interval] === 0
                            ? "Free forever"
                            : interval === "yearly"
                              ? "per creator, billed yearly"
                              : "per creator, billed monthly"}
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-bold tracking-tight text-foreground">
                          Custom
                        </span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          annual contract
                        </p>
                      </>
                    )}
                  </div>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {meta.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="flex items-start gap-2 text-[13px] leading-snug text-foreground"
                      >
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={meta.cta.href}
                    className={cn(
                      "mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-colors",
                      meta.popular
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90"
                        : "border border-border bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    {meta.cta.label}
                  </Link>
                </div>
              );
            })}
          </div>
        </FadeIn>

        {/* Comparison table */}
        <FadeIn delay={0.1} y={32} className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Compare every feature
          </h2>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-64 px-5 py-4 text-sm font-semibold text-foreground">
                    Features
                  </th>
                  {PLAN_ORDER.map((planId) => (
                    <th
                      key={planId}
                      className="px-4 py-4 text-center text-sm font-semibold text-foreground"
                    >
                      {PLANS[planId].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_GROUPS.map((group) => (
                  <Fragment key={group.title}>
                    <tr className="border-b border-border bg-muted/50">
                      <td
                        colSpan={PLAN_ORDER.length + 1}
                        className="px-5 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                      >
                        {group.title}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr
                        key={`${group.title}-${row.label}`}
                        className="border-b border-border last:border-b-0"
                      >
                        <td className="px-5 py-3.5 text-sm text-foreground">
                          {row.label}
                        </td>
                        {PLAN_ORDER.map((planId) => (
                          <td
                            key={planId}
                            className="px-4 py-3.5 text-center"
                          >
                            <ComparisonCell value={row.value(PLANS[planId])} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>

        {/* FAQ */}
        <FadeIn delay={0.1} y={32} className="mx-auto mt-24 max-w-3xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <Collapsible
                key={item.question}
                className="rounded-xl border border-border bg-card shadow-sm"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-foreground transition-colors hover:bg-accent/50 [&[data-state=open]>svg]:rotate-180">
                  {item.question}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </FadeIn>

        {/* Bottom CTA */}
        <FadeIn delay={0.1} className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Still deciding? Start free — it takes 30 seconds.
          </h2>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="w-full rounded-xl bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 sm:w-auto"
            >
              Get started free
            </Link>
            <Link
              href="/enterprise"
              className="w-full rounded-xl border border-border bg-card px-7 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent sm:w-auto"
            >
              Talk to sales
            </Link>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
