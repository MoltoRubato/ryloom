import { MailX } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InviteAcceptCard } from "@/components/auth/invite-accept-card";
import { RyloomLogo } from "@/components/auth/ryloom-logo";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { api } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Workspace invitation",
};

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">
        <Link
          href="/"
          aria-label="Back to Ryloom home"
          className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RyloomLogo />
        </Link>
        {children}
      </div>
    </div>
  );
}

function InvalidInviteCard() {
  return (
    <div className="w-full rounded-xl border border-border bg-card p-8 text-center shadow-sm">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <MailX className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
        This invite isn&apos;t valid
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The invitation link may have expired, been revoked, or already been
        used. Ask a workspace admin to send you a fresh one.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href="/app">Go to my dashboard</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const invite = await api.workspace.getInvite({ token }).catch(() => null);

  if (!invite?.workspace) {
    return (
      <InviteShell>
        <InvalidInviteCard />
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <InviteAcceptCard
        token={token}
        workspaceName={invite.workspace.name}
        workspaceLogoUrl={invite.workspace.logoUrl}
        invitedEmail={invite.invite.email}
        role={invite.invite.role}
        currentEmail={user.email ?? null}
      />
    </InviteShell>
  );
}
