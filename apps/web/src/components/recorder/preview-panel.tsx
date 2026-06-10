"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, History, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { extensionForMimeType } from "@/lib/recorder/engine";
import { probeVideoBlob } from "@/lib/recorder/probe";
import { clear as clearRecovery } from "@/lib/recorder/recovery";
import { uploadRecording, type UploadHandle } from "@/lib/recorder/upload";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, formatDuration, slugify } from "@/lib/utils";
import { api } from "@/trpc/react";

import { type ActiveSession, type PreviewSource } from "./types";

type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "finalizing" }
  | { kind: "error"; message: string };

type BlobMeta = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

/**
 * Post-recording review: playback, title, metadata, TUS upload with progress
 * + cancel + retry, download a local copy, or discard.
 */
export function PreviewPanel({
  blob,
  source,
  durationMs,
  width,
  height,
  title,
  onTitleChange,
  session,
  onUploaded,
  onDiscard,
}: {
  blob: Blob;
  source: PreviewSource;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  title: string;
  onTitleChange: (title: string) => void;
  session: ActiveSession;
  onUploaded: (videoId: string) => void;
  onDiscard: () => void;
}) {
  const completeSession = api.recording.completeSession.useMutation();
  const updateVideo = api.video.update.useMutation();

  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [meta, setMeta] = useState<BlobMeta>({ durationMs, width, height });
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const titleRef = useRef(title);
  titleRef.current = title;
  const handleRef = useRef<UploadHandle | null>(null);

  const objectUrl = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => {
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  // Fill in any metadata the recorder couldn't provide (recovered blobs and
  // file uploads) via a temporary <video> element.
  useEffect(() => {
    if (meta.durationMs !== null && meta.width !== null && meta.height !== null) return;
    let cancelled = false;
    void probeVideoBlob(blob).then((probed) => {
      if (cancelled) return;
      setMeta((current) => ({
        durationMs: current.durationMs ?? probed.durationMs,
        width: current.width ?? probed.width,
        height: current.height ?? probed.height,
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  const busy = phase.kind === "uploading" || phase.kind === "finalizing";

  // Don't let a tab close kill an in-flight upload silently.
  useEffect(() => {
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const finalize = async () => {
    setPhase({ kind: "finalizing" });
    try {
      const trimmed = titleRef.current.trim();
      if (trimmed) {
        try {
          await updateVideo.mutateAsync({
            videoId: session.videoId,
            title: trimmed.slice(0, 300),
          });
        } catch {
          // The default title from createSession stands — not worth failing for.
        }
      }

      const current = metaRef.current;
      const probed =
        current.durationMs === null || current.width === null || current.height === null
          ? await probeVideoBlob(blob)
          : null;
      const finalDuration = current.durationMs ?? probed?.durationMs ?? null;
      const finalWidth = current.width ?? probed?.width ?? null;
      const finalHeight = current.height ?? probed?.height ?? null;

      const result = await completeSession.mutateAsync({
        sessionId: session.sessionId,
        durationMs:
          finalDuration !== null && finalDuration > 0 ? Math.round(finalDuration) : undefined,
        sizeBytes: blob.size > 0 ? blob.size : undefined,
        width: finalWidth !== null && finalWidth > 0 ? Math.round(finalWidth) : undefined,
        height: finalHeight !== null && finalHeight > 0 ? Math.round(finalHeight) : undefined,
      });
      await clearRecovery(session.sessionId).catch(() => undefined);
      toast.success("Recording uploaded — processing has started.");
      onUploaded(result.videoId ?? session.videoId);
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "The upload finished but we couldn't finalize it. Retry to try again.",
      });
    }
  };

  const startUpload = async () => {
    if (busy) return;
    setPhase({ kind: "uploading", percent: 0 });

    let accessToken: string | undefined;
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token;
    } catch {
      accessToken = undefined;
    }
    if (!accessToken) {
      setPhase({
        kind: "error",
        message: "Your sign-in session has expired. Refresh the page and try again.",
      });
      return;
    }

    const handle = uploadRecording({
      blob,
      bucket: session.bucket,
      uploadPath: session.uploadPath,
      tusEndpoint: session.tusEndpoint,
      mimeType: session.mimeType || blob.type || "video/webm",
      accessToken,
      onProgress: (percent) => {
        setPhase((current) =>
          current.kind === "uploading" ? { kind: "uploading", percent } : current,
        );
      },
      onSuccess: () => {
        handleRef.current = null;
        void finalize();
      },
      onError: (error) => {
        setPhase({
          kind: "error",
          message: error.message || "The upload failed. Check your connection and retry.",
        });
      },
    });
    handleRef.current = handle;
    handle.start();
  };

  const cancelUpload = () => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle) void handle.abort().catch(() => undefined);
    setPhase({ kind: "idle" });
    toast.info("Upload canceled — your recording is still here.");
  };

  const handleDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    const ext = extensionForMimeType(session.mimeType || blob.type);
    anchor.download = `${slugify(title.trim()) || "ryloom-recording"}-${Date.now()}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {source === "file" ? "Review your video" : "Review your recording"}
        </h1>
        {source === "recovered" && (
          <Badge variant="secondary" className="gap-1.5">
            <History className="h-3 w-3" />
            Recovered
          </Badge>
        )}
        {source === "file" && <Badge variant="secondary">File upload</Badge>}
      </div>

      <video
        src={objectUrl}
        controls
        playsInline
        className="aspect-video w-full rounded-xl border border-border bg-black"
      />

      <div className="space-y-5 rounded-xl border border-border bg-card/60 p-5 shadow-xl">
        <div className="space-y-2">
          <Label htmlFor="recording-title">Title</Label>
          <Input
            id="recording-title"
            value={title}
            maxLength={300}
            placeholder="Untitled recording"
            disabled={busy}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {meta.durationMs !== null && meta.durationMs > 0 && (
            <span>Duration {formatDuration(meta.durationMs)}</span>
          )}
          <span>Size {formatBytes(blob.size)}</span>
          {meta.width !== null && meta.height !== null && (
            <span>
              {meta.width}×{meta.height}
            </span>
          )}
        </div>

        {phase.kind === "uploading" && (
          <div className="space-y-2 rounded-lg border border-border bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Uploading… {Math.floor(phase.percent)}%</p>
              <Button variant="ghost" size="sm" onClick={cancelUpload} className="gap-1.5">
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
            <Progress value={phase.percent} />
            <p className="text-xs text-muted-foreground">
              Keep this tab open — the upload resumes automatically if your connection drops.
            </p>
          </div>
        )}

        {phase.kind === "finalizing" && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-4">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className="text-sm">Finishing up — handing off to processing…</p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm">{phase.message}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void startUpload()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry upload
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {phase.kind !== "uploading" && phase.kind !== "finalizing" && (
            <Button onClick={() => void startUpload()} className="flex-1 gap-2 sm:flex-none sm:px-8">
              <Upload className="h-4 w-4" />
              Upload
            </Button>
          )}
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download copy
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
            className="gap-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Discard
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The recording will be deleted and can&apos;t be recovered. Download a copy first if
              you want to keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDiscard(false);
                onDiscard();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
