import { Globe, MonitorSmartphone } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { type NameCount } from "@/components/insights/normalize";

function referrerLabel(name: string): string {
  if (!name || name === "Unknown" || name === "direct") return "Direct / unknown";
  try {
    const url = new URL(name);
    return url.hostname || name;
  } catch {
    return name;
  }
}

function BarList({ entries, emptyLabel }: { entries: NameCount[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(...entries.map((e) => e.count), 1);
  return (
    <div className="space-y-3">
      {entries.slice(0, 6).map((entry) => (
        <div key={entry.name} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{entry.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{entry.count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.max(4, (entry.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type BreakdownPanelProps = {
  devices: NameCount[];
  browsers: NameCount[];
  topReferrers: NameCount[];
};

export function BreakdownPanel({ devices, browsers, topReferrers }: BreakdownPanelProps) {
  const referrers = topReferrers.map((r) => ({ ...r, name: referrerLabel(r.name) }));
  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="size-4 text-primary" />
            Devices &amp; browsers
          </CardTitle>
          <CardDescription>Where your video is being watched.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Devices
            </p>
            <BarList entries={devices} emptyLabel="No device data yet." />
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Browsers
            </p>
            <BarList entries={browsers} emptyLabel="No browser data yet." />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-primary" />
            Top referrers
          </CardTitle>
          <CardDescription>Where viewers arrived from.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList entries={referrers} emptyLabel="No referrer data yet." />
        </CardContent>
      </Card>
    </div>
  );
}
