import {
  ArrowRight,
  Clock,
  Database,
  Download,
  Fingerprint,
  Globe,
  KeyRound,
  Link2,
  Lock,
  ShieldCheck,
  FileSearch,
} from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { FadeIn } from "@/components/marketing/motion-primitives";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Ryloom protects your videos: encryption in transit and at rest, Postgres row-level security, signed playback URLs, salted IP hashing, audit logs, and retention controls.",
};

const SECURITY_FEATURES = [
  {
    icon: Lock,
    title: "Encryption in transit & at rest",
    description:
      "All traffic is served over TLS, and every video, transcript, and thumbnail is encrypted at rest in storage. There is no unencrypted path between your recorder and a viewer's player.",
  },
  {
    icon: Database,
    title: "Postgres row-level security",
    description:
      "Access control isn't just application code. RLS policies are enforced at the database layer, so a workspace member can only ever read rows their membership entitles them to — even if a bug slipped past the API.",
  },
  {
    icon: Link2,
    title: "Signed playback URLs",
    description:
      "Videos live in private storage buckets and are never publicly addressable. Playback uses short-lived signed URLs, and HLS streams are served through a proxy that verifies a per-viewer playback token on every request.",
  },
  {
    icon: Fingerprint,
    title: "Salted IP hashing",
    description:
      "View analytics never store raw IP addresses. Every address is salted and hashed before it touches the database, so we can de-duplicate viewers without keeping personal network identifiers.",
  },
  {
    icon: ShieldCheck,
    title: "Password-protected shares",
    description:
      "Lock any share link behind a password. Passwords are hashed with bcrypt — never stored or logged in plaintext — and links can carry their own expiry dates and be revoked at any time.",
  },
  {
    icon: Globe,
    title: "Domain restrictions",
    description:
      "Restrict who can watch by email domain, per video or per share link. Workspaces can also restrict membership to allowed email domains so invites can't leak outside your company.",
  },
  {
    icon: KeyRound,
    title: "SSO & SCIM",
    description:
      "Enterprise workspaces authenticate through SAML single sign-on and can enforce SSO for all members. SCIM provisioning keeps membership in lockstep with your identity provider, with revocable bearer tokens.",
  },
  {
    icon: FileSearch,
    title: "Audit logs",
    description:
      "Privacy changes, deletions, share links created or revoked, role changes, SSO and SCIM events — every sensitive action is written to a workspace-scoped audit log that admins can review and export as CSV.",
  },
  {
    icon: Clock,
    title: "Retention & legal hold",
    description:
      "Set a retention window and videos past it are deleted automatically by a scheduled sweep. Legal hold pauses all deletion — including user-initiated — for workspaces under investigation or litigation.",
  },
  {
    icon: Download,
    title: "Data export & deletion",
    description:
      "Your data is yours. Users can export their profile, videos, and comment metadata as JSON at any time, and account deletion removes the auth user and cascades through all associated records.",
  },
] as const;

export default function SecurityPage() {
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
            <ShieldCheck className="size-3.5 text-primary" />
            Security at Ryloom
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Your videos are work product.
            <br />
            We treat them that way.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Screen recordings contain roadmaps, credentials, customer data, and
            candid conversations. Ryloom is built so that the only people who
            see them are the people you chose.
          </p>
        </FadeIn>

        <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2">
          {SECURITY_FEATURES.map((feature, index) => (
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

        <FadeIn delay={0.1} className="mx-auto mt-16 max-w-3xl">
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Need SSO, SCIM, retention, or audit exports?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The full compliance toolkit — SSO, SCIM provisioning, retention
              policies, legal hold, and audit log exports — is built in and
              available to every workspace.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/download"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors hover:bg-primary/90 sm:w-auto"
              >
                Get Ryloom
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
