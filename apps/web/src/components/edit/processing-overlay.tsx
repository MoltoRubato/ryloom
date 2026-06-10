"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/trpc/react";

const JOB_LABELS: Record<string, string> = {
  trim: "Trimming your video",
  silence_removal: "Removing silences",
  filler_removal: "Removing filler words",
  stitch: "Stitching videos together",
  transcode: "Rendering your video",
  thumbnail: "Generating thumbnails",
  gif_preview: "Generating the animated preview",
  waveform: "Analyzing audio",
  hls: "Preparing streaming renditions",
  transcribe: "Updating the transcript",
};

type ProcessingOverlayProps = {
  videoId: string;
  active: boolean;
  onReady: () => void;
  onFailed: (message: string | null) => void;
};

/**
 * Full-screen overlay shown while a worker edit job runs. Polls
 * video.getProcessingStatus every 4 seconds and reports back when the video
 * flips to ready (or failed).
 */
export function ProcessingOverlay({ videoId, active, onReady, onFailed }: ProcessingOverlayProps) {
  const activatedAtRef = useRef(0);

  useEffect(() => {
    if (active) activatedAtRef.current = Date.now();
  }, [active]);

  const statusQuery = api.video.getProcessingStatus.useQuery(
    { videoId },
    { enabled: active, refetchInterval: active ? 4000 : false },
  );

  const status = statusQuery.data?.status;
  const errorMessage = statusQuery.data?.error ?? null;
  const dataUpdatedAt = statusQuery.dataUpdatedAt;

  useEffect(() => {
    if (!active || !status) return;
    // Ignore data cached before this job started (it may still say "ready").
    if (dataUpdatedAt <= activatedAtRef.current) return;
    if (status === "ready") onReady();
    else if (status === "failed") onFailed(errorMessage);
  }, [active, status, dataUpdatedAt, errorMessage, onReady, onFailed]);

  if (!active) return null;

  const activeJob = statusQuery.data?.jobs.find(
    (job) => job.status === "running" || job.status === "queued",
  );
  const label = (activeJob && JOB_LABELS[activeJob.type]) ?? "Processing your edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm shadow-lg">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">{label}…</p>
            <p className="text-sm text-muted-foreground">
              The original is backed up — you can revert anytime. This usually takes a
              minute or two; the page updates automatically.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
