"use client";

import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function UpgradeCard({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-3.5">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 shrink-0 text-primary" />
        <p className="text-sm font-semibold text-foreground">Upgrade to Pro</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Unlimited videos, recordings beyond 5 minutes, folders, and viewer insights.
      </p>
      <Button asChild size="sm" className="mt-2.5 w-full">
        <Link href={`/app/w/${workspaceId}/settings/billing`} onClick={onNavigate}>
          Upgrade
        </Link>
      </Button>
    </div>
  );
}
