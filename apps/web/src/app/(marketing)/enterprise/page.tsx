import {
  Building2,
  Clock,
  FileSearch,
  Gavel,
  Globe,
  KeyRound,
  Mail,
  ScanEye,
  UserCog,
  Users,
} from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { FadeIn } from "@/components/marketing/motion-primitives";

export const metadata: Metadata = {
  title: "Enterprise",
  description:
    "Ryloom Enterprise: SAML SSO, SCIM provisioning, audit log exports, retention policies, legal hold, advanced admin roles, domain restriction, and viewer-email watermarking.",
};

const ENTERPRISE_FEATURES = [
  {
    icon: KeyRound,
    title: "SAML single sign-on",
    description:
      "Authenticate through your identity provider via Supabase Auth's SAML SSO. Enforce SSO workspace-wide so password logins are off the table, and set custom session durations to match your policy.",
  },
  {
    icon: Users,
    title: "SCIM provisioning",
    description:
      "Connect Okta, Entra, or any SCIM 2.0 IdP. New hires get a seat automatically; departures are deprovisioned the moment they leave your directory. Tokens are hashed at rest and revocable in one click.",
  },
  {
    icon: FileSearch,
    title: "Audit log export",
    description:
      "Every sensitive action — privacy changes, deletions, share links, role changes, SSO and SCIM events — lands in a workspace audit log. Compliance admins can filter by actor or action and export the full history as CSV.",
  },
  {
    icon: Clock,
    title: "Retention policies",
    description:
      "Define how long videos live — 30, 90, 365 days, or forever. A scheduled retention sweep deletes anything past the window automatically, keeping your storage footprint and your risk surface small.",
  },
  {
    icon: Gavel,
    title: "Legal hold",
    description:
      "Flip one switch to suspend every deletion path in a workspace: retention sweeps, trash purges, and user-initiated deletes all pause until the hold is lifted. Built for litigation and investigations.",
  },
  {
    icon: UserCog,
    title: "Advanced admin roles",
    description:
      "Split responsibilities with purpose-built roles: billing admins manage the subscription, content admins manage the library, and compliance admins read audit logs — none of them need full owner access.",
  },
  {
    icon: Globe,
    title: "Domain restriction",
    description:
      "Lock workspace membership to your corporate email domains, and restrict individual videos or share links so only viewers from allowed domains can watch.",
  },
  {
    icon: ScanEye,
    title: "Viewer-email watermark",
    description:
      "Overlay the watching viewer's email address on playback. If a frame of a confidential recording ever leaks, you know exactly whose session it came from.",
  },
] as const;

const TRUST_POINTS = [
  "Postgres row-level security on every table",
  "Signed, expiring playback URLs",
  "Salted IP hashing — raw IPs are never stored",
  "Encryption in transit and at rest",
] as const;

export default function EnterprisePage() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10"
      >
        <div className="mx-auto h-80 w-[48rem] max-w-full rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
            <Building2 className="size-3.5 text-primary" />
            Ryloom Enterprise
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Async video, with the controls your org requires.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Roll Ryloom out to thousands of people without giving up identity,
            retention, or oversight. Everything below ships in the Enterprise
            plan — configured with you, not thrown over the wall.
          </p>
        </FadeIn>

        <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2">
          {ENTERPRISE_FEATURES.map((feature, index) => (
            <FadeIn key={feature.title} delay={(index % 2) * 0.08}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="size-5 text-primary" />
                </span>
                <h2 className="mt-4 text-base font-semibold text-foreground">
                  {feature.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Talk to us CTA */}
        <FadeIn delay={0.1} y={32} className="mx-auto mt-16 max-w-4xl">
          <div className="dark relative overflow-hidden rounded-3xl border border-border bg-background px-6 py-12 text-foreground sm:px-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
            </div>
            <div className="relative grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Talk to us about Enterprise
                </h2>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  Tell us about your team and your compliance requirements.
                  We’ll reply within one business day with a tailored quote and
                  a rollout plan.
                </p>
                <ul className="mt-5 space-y-2">
                  {TRUST_POINTS.map((point) => (
                    <li
                      key={point}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <span className="size-1.5 rounded-full bg-primary" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <a
                  href="mailto:sales@ryloom.com?subject=Ryloom%20Enterprise%20inquiry"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90"
                >
                  <Mail className="size-4" />
                  sales@ryloom.com
                </a>
                <Link
                  href="/security"
                  className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  Read the security overview
                </Link>
                <p className="text-center text-xs text-muted-foreground">
                  Prefer a call? Mention it in your email and we’ll send a
                  calendar link.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
