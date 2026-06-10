import { Suspense } from "react";
import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import {
  AnalyticsDashboard,
  type AnalyticsVideo,
} from "@/components/insights/analytics-dashboard";
import { InsightsSkeleton } from "@/components/insights/insights-skeleton";
import {
  normalizeVideoInsights,
  type VideoInsights,
} from "@/components/insights/normalize";
import { api, HydrateClient } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Video analytics · Ryloom",
};

type PageProps = {
  params: Promise<{ videoId: string }>;
};

export default async function VideoAnalyticsPage({ params }: PageProps) {
  const { videoId } = await params;
  return (
    <HydrateClient>
      <Suspense fallback={<InsightsSkeleton />}>
        <AnalyticsPageContent videoId={videoId} />
      </Suspense>
    </HydrateClient>
  );
}

async function AnalyticsPageContent({ videoId }: { videoId: string }) {
  let data;
  try {
    data = await api.video.get({ videoId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const workspace = await api.workspace.get({ workspaceId: data.video.workspaceId });

  let insights: VideoInsights | null = null;
  let insightsError: string | null = null;
  try {
    const raw: unknown = await api.analytics.getVideoInsights({ videoId });
    insights = normalizeVideoInsights(raw);
  } catch (error) {
    insightsError =
      error instanceof Error ? error.message : "Analytics are unavailable right now";
  }

  const video: AnalyticsVideo = {
    id: data.video.id,
    title: data.video.title,
    durationMs: data.video.durationMs,
    shareToken: data.video.shareToken,
    workspaceId: data.video.workspaceId,
  };

  return (
    <AnalyticsDashboard
      video={video}
      insights={insights}
      insightsError={insightsError}
      plan={workspace.plan}
    />
  );
}
