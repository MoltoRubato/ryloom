"use client";

import { Info, Loader2, MicOff } from "lucide-react";
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
import { api } from "@/trpc/react";
import { FeatureGate } from "@/components/edit/feature-gate";

type FillerCardProps = {
  videoId: string;
  workspaceId: string;
  enabled: boolean;
  transcriptReady: boolean;
  disabled: boolean;
  onJobStarted: () => void;
};

export function FillerCard({
  videoId,
  workspaceId,
  enabled,
  transcriptReady,
  disabled,
  onJobStarted,
}: FillerCardProps) {
  const mutation = api.video.requestFillerRemoval.useMutation({
    onSuccess: () => {
      toast.info("Removing filler words — this can take a minute");
      onJobStarted();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <FeatureGate
      enabled={enabled}
      feature="fillerWordRemoval"
      label="Filler word removal"
      workspaceId={workspaceId}
    >
      <Card className="h-full shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MicOff className="size-4 text-primary" />
            Filler word removal
          </CardTitle>
          <CardDescription>
            Removes &ldquo;um&rdquo;, &ldquo;uh&rdquo;, &ldquo;like&rdquo;, &ldquo;you
            know&rdquo; and other filler words using the word-level transcript, then
            re-renders the video without them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>• Uses word timings from the transcript for frame-accurate cuts</li>
            <li>• Keeps natural pacing — only the filler itself is removed</li>
            <li>• The original recording stays backed up</li>
          </ul>
          {!transcriptReady && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>
                A finished transcript is required. Yours is still being generated — check
                back in a few minutes.
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={disabled || !transcriptReady || mutation.isPending}
            onClick={() => mutation.mutate({ videoId })}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MicOff className="size-4" />
            )}
            Remove filler words
          </Button>
        </CardFooter>
      </Card>
    </FeatureGate>
  );
}
