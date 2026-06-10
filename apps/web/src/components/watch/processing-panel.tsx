"use client";

import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Clapperboard,
  Loader2,
  XCircle,
} from "lucide-react";

import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

const JOB_LABELS: Record<string, string> = {
  probe: "Analyzing recording",
  transcode: "Transcoding video",
  thumbnail: "Creating thumbnails",
  gif_preview: "Building animated preview",
  waveform: "Extracting audio waveform",
  hls: "Preparing adaptive streaming",
  transcribe: "Transcribing audio",
  ai_generate: "Generating AI insights",
  trim: "Trimming video",
  stitch: "Stitching videos",
  silence_removal: "Removing silences",
  filler_removal: "Removing filler words",
  burn_captions: "Burning in captions",
  export: "Exporting",
  retention_sweep: "Retention sweep",
};

export function ProcessingPanel({
  videoId,
  status,
  onStatusChange,
}: {
  videoId: string;
  status: string;
  /** Fired when polling sees the video leave the processing state. */
  onStatusChange: (status: string) => void;
}) {
  const statusQuery = api.video.getProcessingStatus.useQuery(
    { videoId },
    { refetchInterval: 4000 },
  );

  const notifiedRef = useRef<string | null>(null);
  const polledStatus = statusQuery.data?.status;
  useEffect(() => {
    if (!polledStatus) return;
    if (polledStatus !== status && notifiedRef.current !== polledStatus) {
      notifiedRef.current = polledStatus;
      onStatusChange(polledStatus);
    }
  }, [polledStatus, status, onStatusChange]);

  const jobs = statusQuery.data?.jobs ?? [];

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-6 px-6 py-12">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Clapperboard className="h-8 w-8 text-primary" />
          </div>
          <Loader2 className="absolute -bottom-1 -right-1 h-6 w-6 animate-spin rounded-full bg-card p-0.5 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold">
            {status === "uploading" ? "Finishing your upload…" : "Processing your video…"}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            We're optimizing playback, generating thumbnails and writing the
            transcript. This page refreshes automatically.
          </p>
        </div>

        {jobs.length > 0 && (
          <ul className="w-full max-w-sm space-y-2">
            {[...jobs].reverse().map((job) => (
              <li
                key={job.id}
                className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm"
              >
                {job.status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                ) : job.status === "running" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : job.status === "failed" ? (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "flex-1",
                    job.status === "queued" && "text-muted-foreground",
                  )}
                >
                  {JOB_LABELS[job.type] ?? job.type}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {job.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
