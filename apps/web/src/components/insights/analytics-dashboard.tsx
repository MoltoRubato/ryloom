"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { type PlanLimits } from "@/lib/plans";
import { BreakdownPanel } from "@/components/insights/breakdown-panel";
import { InsightsUnavailable, ZeroViewsState } from "@/components/insights/empty-states";
import { EngagementChart } from "@/components/insights/engagement-chart";
import { ExportCsvButton } from "@/components/insights/export-csv-button";
import { type VideoInsights } from "@/components/insights/normalize";
import { StatCards } from "@/components/insights/stat-cards";
import { ViewersTable } from "@/components/insights/viewers-table";
import { ViewsChart } from "@/components/insights/views-chart";

export type AnalyticsVideo = {
  id: string;
  title: string;
  durationMs: number | null;
  shareToken: string;
  workspaceId: string;
};

type AnalyticsDashboardProps = {
  video: AnalyticsVideo;
  insights: VideoInsights | null;
  insightsError: string | null;
  plan: PlanLimits;
};

export function AnalyticsDashboard({
  video,
  insights,
  insightsError,
  plan,
}: AnalyticsDashboardProps) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/app/video/${video.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to video
          </Link>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Analytics</h1>
          <p className="max-w-xl truncate text-sm text-muted-foreground">{video.title}</p>
        </div>
        <ExportCsvButton videoId={video.id} enabled={plan.exportAnalyticsCsv} />
      </div>

      {insights === null ? (
        <InsightsUnavailable
          message={insightsError}
          plan={plan}
          workspaceId={video.workspaceId}
        />
      ) : insights.totalViews === 0 ? (
        <ZeroViewsState shareToken={video.shareToken} />
      ) : (
        <>
          <StatCards insights={insights} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-6">
              <EngagementChart
                timeline={insights.engagementTimeline}
                durationMs={video.durationMs}
                gated={!plan.engagementGraph}
                workspaceId={video.workspaceId}
              />
              <ViewsChart viewsByDay={insights.viewsByDay} />
              <ViewersTable
                viewers={insights.viewers}
                gated={!plan.viewerInsights}
                workspaceId={video.workspaceId}
              />
            </div>
            <BreakdownPanel
              devices={insights.devices}
              browsers={insights.browsers}
              topReferrers={insights.topReferrers}
            />
          </div>
        </>
      )}
    </div>
  );
}
