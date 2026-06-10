"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AuthCard } from "@/components/auth/auth-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

function formatRole(role: string): string {
  const label = role.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type InviteAcceptCardProps = {
  token: string;
  workspaceName: string;
  workspaceLogoUrl: string | null;
  invitedEmail: string;
  role: string;
  currentEmail: string | null;
};

export function InviteAcceptCard({
  token,
  workspaceName,
  workspaceLogoUrl,
  invitedEmail,
  role,
  currentEmail,
}: InviteAcceptCardProps) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const emailMismatch =
    !!currentEmail && currentEmail.toLowerCase() !== invitedEmail.toLowerCase();

  const acceptInvite = api.workspace.acceptInvite.useMutation({
    onSuccess: ({ workspaceId }) => {
      toast.success(`Welcome to ${workspaceName}!`);
      router.push(`/app/w/${workspaceId}`);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  async function switchAccount() {
    setSwitching(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      setSwitching(false);
      return;
    }
    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    router.refresh();
  }

  const pending = acceptInvite.isPending || acceptInvite.isSuccess;

  return (
    <AuthCard
      title="You've been invited"
      description={`Join ${workspaceName} on Ryloom`}
      footer={
        <Link
          href="/app"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Not now — take me to my dashboard
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-accent/40 p-4">
          <Avatar className="size-11 rounded-lg">
            {workspaceLogoUrl ? (
              <AvatarImage src={workspaceLogoUrl} alt={workspaceName} />
            ) : null}
            <AvatarFallback className="rounded-lg bg-primary/10 font-medium text-primary">
              {getInitials(workspaceName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{workspaceName}</p>
            <p className="truncate text-sm text-muted-foreground">
              Invited: {invitedEmail}
            </p>
          </div>
          <Badge variant="secondary">{formatRole(role)}</Badge>
        </div>

        {emailMismatch ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="leading-snug">
              This invite was sent to{" "}
              <span className="font-medium">{invitedEmail}</span>, but you&apos;re
              signed in as <span className="font-medium">{currentEmail}</span>.
              Switch accounts to accept it.
            </p>
          </div>
        ) : null}

        {emailMismatch ? (
          <Button
            type="button"
            className="w-full"
            onClick={switchAccount}
            disabled={switching}
          >
            {switching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Sign in as {invitedEmail}
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={() => acceptInvite.mutate({ token })}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {acceptInvite.isSuccess ? "Joined! Redirecting…" : "Accept invitation"}
          </Button>
        )}
      </div>
    </AuthCard>
  );
}
