"use client";

import { useState } from "react";
import { Loader2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { api } from "@/trpc/react";
import { FeatureGate } from "@/components/edit/feature-gate";

type SilenceCardProps = {
  videoId: string;
  workspaceId: string;
  enabled: boolean;
  disabled: boolean;
  onJobStarted: () => void;
};

export function SilenceCard({
  videoId,
  workspaceId,
  enabled,
  disabled,
  onJobStarted,
}: SilenceCardProps) {
  const [thresholdDb, setThresholdDb] = useState(-35);
  const [minSilenceMs, setMinSilenceMs] = useState(900);
  const [paddingMs, setPaddingMs] = useState(150);

  const mutation = api.video.requestSilenceRemoval.useMutation({
    onSuccess: () => {
      toast.info("Removing silences — this can take a minute");
      onJobStarted();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <FeatureGate
      enabled={enabled}
      feature="silenceRemoval"
      label="Silence removal"
      workspaceId={workspaceId}
    >
      <Card className="h-full shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <VolumeX className="size-4 text-primary" />
            Silence removal
          </CardTitle>
          <CardDescription>
            Automatically cuts the silent gaps from your recording — dead air between
            sentences, long pauses while you click around — and re-renders a tighter video.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`silence-threshold-${videoId}`}>Silence threshold</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {thresholdDb} dB
              </span>
            </div>
            <Slider
              id={`silence-threshold-${videoId}`}
              min={-60}
              max={-10}
              step={1}
              value={[thresholdDb]}
              onValueChange={(values) => setThresholdDb(values[0] ?? -35)}
              disabled={disabled || mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Audio below this level counts as silence. Lower is stricter.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`silence-min-${videoId}`}>Minimum silence</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {(minSilenceMs / 1000).toFixed(1)}s
              </span>
            </div>
            <Slider
              id={`silence-min-${videoId}`}
              min={300}
              max={5000}
              step={100}
              value={[minSilenceMs]}
              onValueChange={(values) => setMinSilenceMs(values[0] ?? 900)}
              disabled={disabled || mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Only gaps at least this long are removed.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`silence-padding-${videoId}`}>Padding</Label>
              <span className="text-sm text-muted-foreground tabular-nums">{paddingMs}ms</span>
            </div>
            <Slider
              id={`silence-padding-${videoId}`}
              min={0}
              max={500}
              step={10}
              value={[paddingMs]}
              onValueChange={(values) => setPaddingMs(values[0] ?? 150)}
              disabled={disabled || mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Breathing room kept around each cut so speech never sounds clipped.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={disabled || mutation.isPending}
            onClick={() =>
              mutation.mutate({ videoId, thresholdDb, minSilenceMs, paddingMs })
            }
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <VolumeX className="size-4" />
            )}
            Remove silences
          </Button>
        </CardFooter>
      </Card>
    </FeatureGate>
  );
}
