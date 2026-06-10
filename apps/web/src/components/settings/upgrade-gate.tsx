"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPlan, minimumPlanFor, type PlanLimits } from "@/lib/plans";
import { cn } from "@/lib/utils";

type UpgradeGateProps = {
  /** When true the gate is open and children render normally. */
  enabled: boolean;
  /** Plan feature key used to compute the minimum plan that unlocks it. */
  feature: keyof PlanLimits;
  /** Human-readable feature name shown in the overlay. */
  label: string;
  workspaceId: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Wraps gated settings content. When the workspace plan lacks the feature,
 * the content is dimmed and non-interactive with a lock overlay + upgrade CTA.
 */
export function UpgradeGate({
  enabled,
  feature,
  label,
  workspaceId,
  children,
  className,
}: UpgradeGateProps) {
  if (enabled) return <>{children}</>;

  const requiredPlan = getPlan(minimumPlanFor(feature));

  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none select-none opacity-50 blur-[1px]"
      >
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 p-6 backdrop-blur-[2px]">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="size-3" />
                {requiredPlan.name}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Upgrade to the {requiredPlan.name} plan to unlock {label.toLowerCase()}.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`/app/w/${workspaceId}/settings/billing`}>View plans</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
