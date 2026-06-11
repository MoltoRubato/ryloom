"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import type { EditRange } from "@ryloom/db";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { normalizeKeepRanges } from "@/lib/edit-ranges";
import { type PlanLimits } from "@/lib/plans";
import { formatDuration } from "@/lib/utils";
import { api } from "@/trpc/react";

import { ChaptersCard } from "@/components/edit/chapters-card";
import { CtaCard } from "@/components/edit/cta-card";
import { DetailsCard } from "@/components/edit/details-card";
import { FillerCard } from "@/components/edit/filler-card";
import { ProcessingOverlay } from "@/components/edit/processing-overlay";
import { RevertCard } from "@/components/edit/revert-card";
import { SilenceCard } from "@/components/edit/silence-card";
import { ThumbnailCard } from "@/components/edit/thumbnail-card";
import { Timeline } from "@/components/edit/timeline";
import {
  clampMs,
  keptDurationMs,
  MAX_KEEP_RANGES,
  MIN_CUT_MS,
  MIN_KEEP_MS,
  type KeepRange,
  type VideoGetOutput,
} from "@/components/edit/types";

type EditStudioProps = {
  data: VideoGetOutput;
  plan: PlanLimits;
};

/**
 * Lifecycle of a non-destructive (background) edit:
 * - "idle": nothing pending.
 * - "pending": pendingEditRanges saved (or a silence/filler job queued) — the
 *   trim is already live for viewers; the worker flattens in the background.
 * - "failed": the background flatten failed; the trim stays applied for
 *   viewers via pendingEditRanges, only the chip turns into a notice.
 */
type EditPhase = "idle" | "pending" | "failed";

export function EditStudio({ data, plan }: EditStudioProps) {
  const router = useRouter();
  const video = data.video;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [durationMs, setDurationMs] = useState(video.durationMs ?? 0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [keepRanges, setKeepRanges] = useState<KeepRange[]>([
    { startMs: 0, endMs: video.durationMs ?? 0 },
  ]);
  const [previewCuts, setPreviewCuts] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [processing, setProcessing] = useState(video.status === "processing");

  // Non-destructive background edit (page may have loaded mid-flatten).
  const [pendingEdit, setPendingEdit] = useState<EditRange[] | null>(
    video.pendingEditRanges && video.pendingEditRanges.length > 0
      ? normalizeKeepRanges(video.pendingEditRanges)
      : null,
  );
  const [editPhase, setEditPhase] = useState<EditPhase>(
    video.pendingEditRanges && video.pendingEditRanges.length > 0
      ? "pending"
      : "idle",
  );
  const [pendingMessage, setPendingMessage] = useState(
    "Edit saved — finalizing in background. Viewers already see the edited video.",
  );
  // Ignore status data cached before the current edit started.
  const editStartedAtRef = useRef(0);

  // Keep local state in line with the server row after router.refresh().
  useEffect(() => {
    setProcessing(video.status === "processing");
  }, [video.status]);

  useEffect(() => {
    setDurationMs(video.durationMs ?? 0);
  }, [video.durationMs]);

  useEffect(() => {
    setKeepRanges([{ startMs: 0, endMs: durationMs }]);
  }, [durationMs]);

  // Resync the pending-edit state from the server row after router.refresh():
  // when the ranges were cleared server-side (e.g. a revert), drop the stale
  // chip/banner and stop skipping ranges that no longer exist. Never while a
  // mutation is mid-flight ("pending") — the poll owns that transition, and
  // the prop may still predate an optimistic just-applied edit.
  useEffect(() => {
    if (video.pendingEditRanges && video.pendingEditRanges.length > 0) return;
    if (editPhase === "pending") return;
    setPendingEdit(null);
    setEditPhase("idle");
  }, [video.pendingEditRanges, editPhase]);

  // ----- Playhead sync (video -> timeline) ------------------------------------

  // Ranges the studio player skips during playback: the user's draft while
  // previewing, otherwise the pending background edit (so the owner hears
  // exactly what viewers already see).
  const playbackKeeps = previewCuts ? keepRanges : pendingEdit;

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const element = videoRef.current;
      if (element) {
        const ms = element.currentTime * 1000;
        // The timeupdate/rAF loop skips over cut ranges.
        if (playbackKeeps && playbackKeeps.length > 0 && durationMs > 0) {
          const inside = playbackKeeps.find((r) => ms >= r.startMs && ms < r.endMs);
          if (!inside) {
            const next = playbackKeeps.find((r) => r.startMs > ms);
            if (next) {
              element.currentTime = next.startMs / 1000;
            } else {
              element.pause();
              const last = playbackKeeps[playbackKeeps.length - 1];
              if (last) element.currentTime = last.endMs / 1000;
            }
          }
        }
        setCurrentTimeMs(Math.round(element.currentTime * 1000));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackKeeps, durationMs]);

  // ----- Timeline -> video ------------------------------------------------------

  const handleSeek = useCallback((ms: number) => {
    const element = videoRef.current;
    if (element && Number.isFinite(ms)) element.currentTime = ms / 1000;
    setCurrentTimeMs(ms);
  }, []);

  // ----- Trim state --------------------------------------------------------------

  const first = keepRanges[0];
  const hasEdits =
    keepRanges.length > 1 ||
    (first ? first.startMs > 0 || first.endMs < durationMs : false);
  const keptMs = keptDurationMs(keepRanges);
  const editingLocked = processing || video.status !== "ready";
  // A background edit in flight only disables the edit *actions* — the
  // timeline, metadata cards and playback all stay usable.
  const editInFlight = editPhase === "pending";

  const beginPendingEdit = useCallback(
    (ranges: EditRange[] | null, message: string) => {
      editStartedAtRef.current = Date.now();
      setPendingEdit(ranges && ranges.length > 0 ? normalizeKeepRanges(ranges) : null);
      setPendingMessage(message);
      setEditPhase("pending");
    },
    [],
  );

  const trimMutation = api.video.requestTrim.useMutation({
    onSuccess: (_data, variables) => {
      // Non-blocking: the trim is already live for viewers via
      // pendingEditRanges; the worker flattens in the background.
      beginPendingEdit(
        variables.keepRanges,
        "Trim saved — finalizing in background. Viewers already see the trimmed video.",
      );
      setPreviewCuts(false);
      toast.success("Trim saved — viewers already see the trimmed video");
    },
    onError: (error) => toast.error(error.message),
  });

  // ----- Background-edit polling ---------------------------------------------

  const editStatusQuery = api.video.getProcessingStatus.useQuery(
    { videoId: video.id },
    { enabled: editInFlight, refetchInterval: editInFlight ? 4000 : false },
  );

  const editStatus = editStatusQuery.data;
  const editStatusUpdatedAt = editStatusQuery.dataUpdatedAt;
  useEffect(() => {
    if (editPhase !== "pending" || !editStatus) return;
    // Ignore data cached before this edit was requested.
    if (editStatusUpdatedAt <= editStartedAtRef.current) return;
    if (editStatus.editJob === "failed") {
      // Failure semantics: pendingEditRanges stays set, so the trim keeps
      // applying for viewers — only the chip becomes a notice.
      if (editStatus.pendingEditRanges && editStatus.pendingEditRanges.length > 0) {
        setPendingEdit(normalizeKeepRanges(editStatus.pendingEditRanges));
      }
      setEditPhase("failed");
      return;
    }
    if (editStatus.editJob === null) {
      if (editStatus.pendingEditRanges && editStatus.pendingEditRanges.length > 0) {
        // No edit job left but the ranges were never cleared (a job exited
        // without flattening, or an orphaned partial write). Same semantics
        // as a failure: the ranges still apply for viewers, the user can
        // re-trim or revert — without this the chip would spin forever.
        setPendingEdit(normalizeKeepRanges(editStatus.pendingEditRanges));
        setEditPhase("failed");
        return;
      }
      // Flatten finished: the playback file was swapped and the pending
      // ranges cleared in one update. Pick up the new file + duration.
      setPendingEdit(null);
      setEditPhase("idle");
      setPreviewCuts(false);
      toast.success("Edit finalized — the new video file is live");
      router.refresh();
      return;
    }
    if (editStatus.pendingEditRanges && editStatus.pendingEditRanges.length > 0) {
      // Silence/filler jobs publish their ranges mid-job — pick them up live.
      const next = normalizeKeepRanges(editStatus.pendingEditRanges);
      setPendingEdit((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    }
  }, [editPhase, editStatus, editStatusUpdatedAt, router]);

  const addCutAtPlayhead = () => {
    if (durationMs <= 0 || editingLocked) return;
    if (keepRanges.length >= MAX_KEEP_RANGES) {
      toast.error(`A trim can have at most ${MAX_KEEP_RANGES} kept sections`);
      return;
    }
    const index = keepRanges.findIndex(
      (r) => currentTimeMs > r.startMs && currentTimeMs < r.endMs,
    );
    const range = index >= 0 ? keepRanges[index] : undefined;
    if (index < 0 || !range) {
      toast.error("Move the playhead inside a kept section to add a cut");
      return;
    }
    const length = range.endMs - range.startMs;
    if (length < MIN_KEEP_MS * 2 + MIN_CUT_MS) {
      toast.error("This section is too short to cut");
      return;
    }
    const half = Math.min(1000, Math.floor(length / 8));
    let cutStart = Math.max(range.startMs + MIN_KEEP_MS, currentTimeMs - half);
    let cutEnd = Math.min(range.endMs - MIN_KEEP_MS, currentTimeMs + half);
    if (cutEnd - cutStart < MIN_CUT_MS) {
      const mid = clampMs(
        currentTimeMs,
        range.startMs + MIN_KEEP_MS + MIN_CUT_MS / 2,
        range.endMs - MIN_KEEP_MS - MIN_CUT_MS / 2,
      );
      cutStart = Math.round(mid - MIN_CUT_MS / 2);
      cutEnd = Math.round(mid + MIN_CUT_MS / 2);
    }
    setKeepRanges([
      ...keepRanges.slice(0, index),
      { startMs: range.startMs, endMs: cutStart },
      { startMs: cutEnd, endMs: range.endMs },
      ...keepRanges.slice(index + 1),
    ]);
  };

  const resetTrim = () => {
    setKeepRanges([{ startMs: 0, endMs: durationMs }]);
    setPreviewCuts(false);
  };

  const applyTrim = () => {
    const ranges = keepRanges
      .map((r) => ({
        startMs: Math.max(0, Math.round(r.startMs)),
        endMs: Math.min(Math.round(r.endMs), Math.max(1, Math.round(durationMs))),
      }))
      .filter((r) => r.endMs > r.startMs);
    if (ranges.length === 0) {
      toast.error("Keep at least one section of the video");
      return;
    }
    trimMutation.mutate({ videoId: video.id, keepRanges: ranges });
  };

  // ----- Processing completion -----------------------------------------------------

  const handleProcessed = useCallback(() => {
    setProcessing(false);
    setPreviewCuts(false);
    toast.success("Edit applied — your video is ready");
    router.refresh();
  }, [router]);

  const handleFailed = useCallback(
    (message: string | null) => {
      setProcessing(false);
      toast.error(message ?? "Processing failed — your previous version is untouched");
      router.refresh();
    },
    [router],
  );

  // ----- Derived ---------------------------------------------------------------------

  const hasBackup = video.assets.some(
    (asset) => asset.type === "original_backup" && asset.status !== "deleted",
  );
  const transcriptReady = video.captionsUrl !== null;
  const mp4Url = data.playback.mp4Url;

  if (!data.canEdit) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6 lg:p-8">
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ShieldAlert className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">You can&apos;t edit this video</h1>
              <p className="text-sm text-muted-foreground">
                Only the owner or a workspace admin can edit it.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href={`/app/video/${video.id}`}>
                <ArrowLeft className="size-4" />
                Back to video
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Edit video</h1>
          <p className="max-w-xl truncate text-sm text-muted-foreground">{video.title}</p>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {formatDuration(durationMs)}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: preview, timeline, edit jobs */}
        <div className="min-w-0 space-y-6">
          <Card className="shadow-sm">
            <CardContent className="space-y-4 p-4 sm:p-6">
              {mp4Url ? (
                <video
                  ref={videoRef}
                  src={mp4Url}
                  crossOrigin="anonymous"
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full rounded-xl border border-border bg-black object-contain"
                  onLoadedMetadata={(e) => {
                    const seconds = e.currentTarget.duration;
                    if (Number.isFinite(seconds) && seconds > 0) {
                      setDurationMs((prev) =>
                        prev > 0 ? prev : Math.round(seconds * 1000),
                      );
                    }
                  }}
                  onTimeUpdate={(e) =>
                    setCurrentTimeMs(Math.round(e.currentTarget.currentTime * 1000))
                  }
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-border bg-muted">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    {video.status === "processing" ? (
                      <Loader2 className="size-8 animate-spin" />
                    ) : (
                      <Film className="size-8" />
                    )}
                    <p className="text-sm">
                      {video.status === "processing"
                        ? "Processing — the preview will appear soon"
                        : "No playable preview yet"}
                    </p>
                  </div>
                </div>
              )}

              <Timeline
                durationMs={durationMs}
                currentTimeMs={currentTimeMs}
                keepRanges={keepRanges}
                waveformUrl={video.waveformUrl}
                disabled={editingLocked}
                onSeek={handleSeek}
                onChangeRanges={setKeepRanges}
              />

              {/* Trim controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={editingLocked || durationMs <= 0}
                    onClick={addCutAtPlayhead}
                  >
                    <Scissors className="size-4" />
                    Add cut
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`preview-cuts-${video.id}`}
                      checked={previewCuts}
                      onCheckedChange={setPreviewCuts}
                      disabled={durationMs <= 0}
                    />
                    <Label
                      htmlFor={`preview-cuts-${video.id}`}
                      className="text-sm text-muted-foreground"
                    >
                      Preview cuts
                    </Label>
                  </div>
                  {hasEdits && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={resetTrim}
                    >
                      <RotateCcw className="size-4" />
                      Reset
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {hasEdits ? (
                      <>
                        Result:{" "}
                        <span className="font-medium text-foreground">
                          {formatDuration(keptMs)}
                        </span>{" "}
                        · removing {formatDuration(Math.max(0, durationMs - keptMs))}
                      </>
                    ) : (
                      "Drag the handles or add cuts to trim"
                    )}
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={
                          !hasEdits ||
                          editingLocked ||
                          editInFlight ||
                          trimMutation.isPending
                        }
                      >
                        {trimMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Scissors className="size-4" />
                        )}
                        Apply trim
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Apply this trim?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Your video will go from {formatDuration(durationMs)} to{" "}
                          {formatDuration(keptMs)}. Viewers see the trimmed version
                          immediately — the file re-renders in the background and the
                          original stays backed up, so you can revert anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={applyTrim}>Apply trim</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {/* Background-edit status (non-blocking) */}
              {editInFlight && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  <span>{pendingMessage}</span>
                </div>
              )}
              {editPhase === "failed" && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Background save failed — the trim is still applied for viewers;
                    retry from the edit menu.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <SilenceCard
              videoId={video.id}
              workspaceId={video.workspaceId}
              enabled={plan.silenceRemoval}
              disabled={editingLocked || editInFlight}
              onJobStarted={() =>
                beginPendingEdit(null, "Removing silences in background…")
              }
            />
            <FillerCard
              videoId={video.id}
              workspaceId={video.workspaceId}
              enabled={plan.fillerWordRemoval}
              transcriptReady={transcriptReady}
              disabled={editingLocked || editInFlight}
              onJobStarted={() =>
                beginPendingEdit(null, "Removing filler words in background…")
              }
            />
          </div>

          {hasBackup && (
            <RevertCard
              videoId={video.id}
              disabled={editingLocked}
              onJobStarted={() => {
                // The revert clears pendingEditRanges server-side — drop any
                // stale pending/failed edit state right away.
                setPendingEdit(null);
                setEditPhase("idle");
                setProcessing(true);
              }}
            />
          )}
        </div>

        {/* Right: metadata cards */}
        <div className="min-w-0 space-y-6">
          <DetailsCard
            videoId={video.id}
            title={video.title}
            description={video.description}
          />
          <ThumbnailCard
            videoId={video.id}
            workspaceId={video.workspaceId}
            enabled={plan.customThumbnails}
            thumbnailUrl={data.playback.thumbnailUrl}
            hasCustomThumbnail={video.customThumbnailUrl !== null}
            videoRef={videoRef}
          />
          <CtaCard
            videoId={video.id}
            cta={video.cta ?? null}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
          />
          <ChaptersCard
            videoId={video.id}
            chapters={video.chapters ?? null}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
          />
        </div>
      </div>

      <ProcessingOverlay
        videoId={video.id}
        active={processing}
        onReady={handleProcessed}
        onFailed={handleFailed}
      />
    </div>
  );
}
