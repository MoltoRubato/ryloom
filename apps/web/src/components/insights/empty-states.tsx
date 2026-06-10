"use client";

import Link from "next/link";
import { BarChart3, ExternalLink, Link as LinkIcon, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { minimumPlanFor, PLANS, type PlanLimits } from "@/lib/plans";

type ZeroViewsStateProps = {
  shareToken: string;
};

/** Shown when the video has analytics enabled but nobody has watched it yet. */
export function ZeroViewsState({ shareToken }: ZeroViewsStateProps) {
  async function copyShareLink() {
    try {
      const url = `${window.location.origin}/share/${shareToken}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied");
    } catch {
      toast.error("Couldn't copy the link — copy it from the share page instead");
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <BarChart3 className="size-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">No views yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Share your video to start collecting insights — views, watch time, engagement
            and more will show up here.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => void copyShareLink()}>
            <LinkIcon className="size-4" />
            Copy share link
          </Button>
          <Button asChild variant="outline">
            <Link href={`/share/${shareToken}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Open share page
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type InsightsUnavailableProps = {
  message: string | null;
  plan: PlanLimits;
  workspaceId: string;
};

/** Shown when analytics.getVideoInsights throws (plan gate, permissions…). */
export function InsightsUnavailable({ message, plan, workspaceId }: InsightsUnavailableProps) {
  const gated = !plan.viewerInsights;
  const planName = PLANS[minimumPlanFor("viewerInsights")].name;
  return (
    <Card className="shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Lock className="size-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Analytics unavailable</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {gated
              ? `Viewer insights are available on the ${planName} plan and above.`
              : (message ?? "We couldn't load analytics for this video right now.")}
          </p>
        </div>
        {gated && (
          <Button asChild>
            <Link href={`/app/w/${workspaceId}/settings/billing`}>Upgrade</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
