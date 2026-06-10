import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { minimumPlanFor, PLANS, type PlanLimits } from "@/lib/plans";
import { cn } from "@/lib/utils";

type FeatureGateProps = {
  /** When true the children render untouched. */
  enabled: boolean;
  /** Plan-matrix key used to compute the minimum plan name. */
  feature: keyof PlanLimits;
  /** Human label, e.g. "Silence removal". */
  label: string;
  workspaceId: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Wraps a card (or any block) in a lock overlay with an upgrade link when the
 * workspace plan does not include the feature.
 */
export function FeatureGate({
  enabled,
  feature,
  label,
  workspaceId,
  children,
  className,
}: FeatureGateProps) {
  if (enabled) return <>{children}</>;
  const planName = PLANS[minimumPlanFor(feature)].name;
  return (
    <div className={cn("relative", className)}>
      <div aria-hidden className="pointer-events-none select-none opacity-50">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/75 p-6 text-center backdrop-blur-[2px]">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <Lock className="size-5 text-primary" />
        </div>
        <p className="max-w-xs text-sm font-medium text-foreground">
          {label} is available on the {planName} plan
        </p>
        <Button asChild size="sm">
          <Link href={`/app/w/${workspaceId}/settings/billing`}>Upgrade</Link>
        </Button>
      </div>
    </div>
  );
}
