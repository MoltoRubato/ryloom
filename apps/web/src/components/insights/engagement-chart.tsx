"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";
import { FeatureGate } from "@/components/edit/feature-gate";

type EngagementChartProps = {
  /** 100 buckets, % of viewers still watching. */
  timeline: number[];
  durationMs: number | null;
  gated: boolean;
  workspaceId: string;
};

export function EngagementChart({
  timeline,
  durationMs,
  gated,
  workspaceId,
}: EngagementChartProps) {
  const data = useMemo(
    () =>
      timeline.map((pct, index) => ({
        label:
          durationMs && durationMs > 0
            ? formatDuration((index / Math.max(1, timeline.length - 1)) * durationMs)
            : `${index + 1}%`,
        pct: Math.round(pct * 10) / 10,
      })),
    [timeline, durationMs],
  );

  return (
    <FeatureGate
      enabled={!gated}
      feature="engagementGraph"
      label="The engagement graph"
      workspaceId={workspaceId}
    >
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-primary" />
            Engagement
          </CardTitle>
          <CardDescription>
            Percentage of viewers still watching at each point in the video.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="engagement-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border)" }}
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.5rem",
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                  formatter={(value: number | string) => [`${String(value)}%`, "Watching"]}
                />
                <Area
                  type="monotone"
                  dataKey="pct"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  fill="url(#engagement-gradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </FeatureGate>
  );
}
