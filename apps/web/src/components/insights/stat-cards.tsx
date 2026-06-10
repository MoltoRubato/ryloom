import {
  CheckCircle2,
  Download,
  Eye,
  Gauge,
  MousePointerClick,
  Users,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatCount } from "@/lib/utils";
import { type VideoInsights } from "@/components/insights/normalize";

export function StatCards({ insights }: { insights: VideoInsights }) {
  const stats = [
    { label: "Views", value: formatCount(insights.totalViews), icon: Eye },
    { label: "Unique viewers", value: formatCount(insights.uniqueViewers), icon: Users },
    { label: "Avg % watched", value: `${Math.round(insights.avgWatchPct)}%`, icon: Gauge },
    {
      label: "Completion rate",
      value: `${Math.round(insights.completionRate)}%`,
      icon: CheckCircle2,
    },
    {
      label: "CTA clicks",
      value: formatCount(insights.eventCounts.ctaClicks),
      icon: MousePointerClick,
    },
    { label: "Downloads", value: formatCount(insights.eventCounts.downloads), icon: Download },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="shadow-sm">
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-4" />
                <span className="text-xs font-medium">{stat.label}</span>
              </div>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
