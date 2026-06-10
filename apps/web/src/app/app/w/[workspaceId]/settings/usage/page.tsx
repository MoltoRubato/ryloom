"use client";

import { useParams } from "next/navigation";
import {
  Clock,
  HardDrive,
  Lock,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import { SettingsSection } from "@/components/settings/settings-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatCount, formatDuration, getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

export default function UsageSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const role = workspaceQuery.data?.role;
  const plan = workspaceQuery.data?.plan;
  const canInsights = role === "owner" || role === "admin";
  const canUsage = canInsights || role === "billing_admin";

  const insightsQuery = api.analytics.getWorkspaceInsights.useQuery(
    { workspaceId },
    { enabled: canInsights, retry: false },
  );
  const usageQuery = api.admin.getUsage.useQuery(
    { workspaceId },
    { enabled: canUsage, retry: false },
  );

  if (
    workspaceQuery.isLoading ||
    (canInsights && insightsQuery.isLoading) ||
    (canUsage && usageQuery.isLoading)
  ) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canUsage) {
    return (
      <SettingsSection
        title="Usage"
        description="Workspace-wide usage and engagement insights."
      >
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Only workspace owners, admins, and billing admins can view usage
            insights.
          </p>
        </div>
      </SettingsSection>
    );
  }

  const insights = insightsQuery.data ?? null;
  const usageData = usageQuery.data ?? null;
  const currentUsage =
    usageData?.usage.find((r) => r.period === usageData.currentPeriod) ??
    usageData?.usage[0] ??
    null;

  const totalVideos =
    usageData?.videoCount ??
    insights?.countsByPrivacy.reduce((sum, row) => sum + row.count, 0) ??
    0;
  const storageBytes = insights?.storageBytes ?? usageData?.storageBytes ?? 0;
  const memberCount = usageData?.memberCount ?? 0;
  const totalWatchMs = insights?.totalWatchMs ?? 0;

  const topVideos = insights?.mostViewedVideos ?? [];
  const creators = insights?.mostActiveCreators ?? [];

  const aiGenerations =
    insights?.aiUsage.aiGenerations ?? currentUsage?.aiGenerations ?? 0;
  const aiLimit = plan?.aiGenerationsPerMonth ?? null;
  const aiPct =
    aiLimit === null || aiLimit === 0
      ? null
      : Math.min(100, Math.round((aiGenerations / aiLimit) * 100));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Video} label="Videos" value={formatCount(totalVideos)} />
        <StatCard icon={Users} label="Members" value={formatCount(memberCount)} />
        <StatCard
          icon={HardDrive}
          label="Storage"
          value={formatBytes(storageBytes)}
        />
        <StatCard
          icon={Clock}
          label="Watch time"
          value={totalWatchMs > 0 ? formatDuration(totalWatchMs) : "0:00"}
        />
      </div>

      <SettingsSection
        title="Top videos"
        description="The most-viewed videos in this workspace."
      >
        {topVideos.length === 0 ? (
          <EmptyState
            message={
              canInsights
                ? "No views yet. Share a video to start collecting insights."
                : "Engagement insights are visible to owners and admins."
            }
          />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topVideos.map((video, index) => (
                  <TableRow key={video.id}>
                    <TableCell className="text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="max-w-72 truncate font-medium">
                      {video.title}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {video.owner.name ?? video.owner.email}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(video.viewCount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsSection
          title="Most active creators"
          description="Who's recording the most."
        >
          {creators.length === 0 ? (
            <EmptyState
              message={
                canInsights
                  ? "No recordings yet."
                  : "Creator insights are visible to owners and admins."
              }
            />
          ) : (
            <ul className="space-y-3">
              {creators.map((creator) => (
                <li key={creator.userId} className="flex items-center gap-3">
                  <Avatar className="size-8">
                    <AvatarImage
                      src={creator.avatarUrl ?? undefined}
                      alt={creator.name ?? creator.email}
                    />
                    <AvatarFallback>
                      {getInitials(creator.name, creator.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {creator.name ?? creator.email}
                    </p>
                    {creator.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {creator.email}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatCount(creator.videosCreated)}{" "}
                    {creator.videosCreated === 1 ? "video" : "videos"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection
          title="AI usage"
          description="AI generations used this month."
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-2xl font-semibold text-foreground">
                {formatCount(aiGenerations)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {aiLimit !== null
                    ? `of ${formatCount(aiLimit)} generations`
                    : "generations · unlimited"}
                </span>
              </p>
              {aiPct !== null ? (
                <Progress value={aiPct} />
              ) : (
                <Progress
                  value={aiGenerations > 0 ? 100 : 0}
                  className="opacity-30"
                />
              )}
              {aiGenerations === 0 && (
                <p className="text-xs text-muted-foreground">
                  No AI generations yet — try generating a summary or chapters on
                  any video.
                </p>
              )}
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
