"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { skipToken } from "@tanstack/react-query";
import { ArrowLeft, Building2, Loader2, Monitor } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  pickSupportedMimeType,
  RecorderAcquireError,
  RecorderEngine,
  type RecordingMode,
} from "@/lib/recorder/engine";
import {
  clear as clearRecovery,
  listUnfinished,
  loadRecording,
  saveChunk,
  saveSession,
  type RecoverySession,
} from "@/lib/recorder/recovery";
import { formatDuration } from "@/lib/utils";
import { api } from "@/trpc/react";

import { CameraBubble } from "./camera-bubble";
import { CountdownOverlay } from "./countdown-overlay";
import { PermissionDialog } from "./permission-dialog";
import { PreviewPanel } from "./preview-panel";
import { RecordingControls } from "./recording-controls";
import { RecoveryBanner } from "./recovery-banner";
import { SetupPanel, type RecorderSettings } from "./setup-panel";
import { type ActiveSession, type PreviewSource } from "./types";
import { UploadFileCard } from "./upload-file-card";

type Phase = "setup" | "starting" | "countdown" | "recording" | "stopping" | "preview";

type PreviewData = {
  blob: Blob;
  source: PreviewSource;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

const VALID_MODES: readonly RecordingMode[] = ["screen", "camera", "screen_camera"];

/** Mirrors the default title `recording.createSession` assigns server-side. */
function defaultRecordingTitle(): string {
  return `Recording — ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/**
 * The /record orchestrator. Owns the phase machine
 * (setup → starting → countdown → recording → stopping → preview), the
 * RecorderEngine instance, crash-recovery bookkeeping and the handoff to the
 * multipart R2 upload in the preview panel.
 */
export function RecorderApp() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- Launch params (also set by the Chrome extension) --------------------
  const paramWorkspaceId = searchParams.get("workspaceId");
  const paramMode = searchParams.get("mode");
  const paramTitle = searchParams.get("title");
  const paramSourceUrl = searchParams.get("sourceUrl");

  const initialTitle = useMemo(() => {
    const trimmed = paramTitle?.trim();
    return trimmed ? trimmed.slice(0, 300) : null;
  }, [paramTitle]);

  const sourceUrl = useMemo(() => {
    if (!paramSourceUrl) return undefined;
    try {
      return new URL(paramSourceUrl).toString();
    } catch {
      return undefined;
    }
  }, [paramSourceUrl]);

  // --- Workspace ------------------------------------------------------------
  const workspaceList = api.workspace.list.useQuery();
  const workspaceRow = useMemo(() => {
    const rows = workspaceList.data;
    if (!rows || rows.length === 0) return null;
    if (paramWorkspaceId) {
      const match = rows.find((row) => row.workspace.id === paramWorkspaceId);
      if (match) return match;
    }
    return rows[0] ?? null;
  }, [workspaceList.data, paramWorkspaceId]);
  const workspaceId = workspaceRow?.workspace.id ?? null;
  const workspaceName = workspaceRow?.workspace.name ?? null;

  const workspaceDetail = api.workspace.get.useQuery(workspaceId ? { workspaceId } : skipToken);
  const plan = workspaceDetail.data?.plan ?? null;

  const utils = api.useUtils();
  const createSession = api.recording.createSession.useMutation();
  const cancelSession = api.recording.cancelSession.useMutation();
  // Stable across renders (unlike the mutation result objects) — safe to use
  // as useCallback dependencies without churning every consumer.
  const createSessionAsync = createSession.mutateAsync;
  const cancelSessionAsync = cancelSession.mutateAsync;

  // --- Recorder state ---------------------------------------------------------
  const [settings, setSettings] = useState<RecorderSettings>(() => ({
    mode:
      paramMode && (VALID_MODES as readonly string[]).includes(paramMode)
        ? (paramMode as RecordingMode)
        : "screen",
    micEnabled: true,
    micDeviceId: "",
    cameraDeviceId: "",
    systemAudio: true,
    bubbleCorner: "bottom-left",
    bubbleSize: 220,
    countdownEnabled: true,
  }));

  const [phase, setPhase] = useState<Phase>("setup");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [title, setTitle] = useState<string>(() => initialTitle ?? defaultRecordingTitle());
  const [paused, setPaused] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [hasMic, setHasMic] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cameraPreview, setCameraPreview] = useState<MediaStream | null>(null);
  const [permissionIssue, setPermissionIssue] = useState<RecorderAcquireError | null>(null);
  const [recoverySessions, setRecoverySessions] = useState<RecoverySession[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  const engineRef = useRef<RecorderEngine | null>(null);
  const phaseRef = useRef<Phase>("setup");
  const sessionRef = useRef<ActiveSession | null>(null);
  const titleRef = useRef(title);
  const stoppingRef = useRef(false);
  const warnedRef = useRef(false);
  /** Recovery key to also clear when it differs from the active sessionId. */
  const extraRecoveryKeyRef = useRef<string | null>(null);
  const pendingRetryRef = useRef<{ session: ActiveSession; workspaceId: string } | null>(null);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const handleSettingsChange = useCallback((patch: Partial<RecorderSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  // --- Teardown helpers -------------------------------------------------------

  /** Destroys the engine, voids the server session and returns to setup. */
  const discardActive = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const engine = engineRef.current;
      engineRef.current = null;
      engine?.destroy();
      setCameraPreview(null);
      setPermissionIssue(null);
      pendingRetryRef.current = null;

      const active = sessionRef.current;
      setSession(null);
      setPreview(null);
      if (active) {
        await clearRecovery(active.sessionId).catch(() => undefined);
        void cancelSessionAsync({ sessionId: active.sessionId }).catch(() => undefined);
      }
      const extraKey = extraRecoveryKeyRef.current;
      if (extraKey) {
        extraRecoveryKeyRef.current = null;
        await clearRecovery(extraKey).catch(() => undefined);
      }
      setPhase("setup");
      if (!silent) toast.info("Recording discarded.");
    },
    [cancelSessionAsync],
  );

  // Release camera/mic/screen if the user navigates away mid-flow.
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // --- Stop → preview ---------------------------------------------------------

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    const engine = engineRef.current;
    if (!engine) return;
    stoppingRef.current = true;
    setPhase("stopping");
    try {
      const blob = await engine.stop();
      const elapsed = Math.round(engine.getElapsedMs());
      const size = engine.getOutputSize();
      engineRef.current = null;
      setCameraPreview(null);

      if (blob.size === 0) {
        toast.error("Nothing was captured — the recording came back empty.");
        const active = sessionRef.current;
        setSession(null);
        if (active) {
          await clearRecovery(active.sessionId).catch(() => undefined);
          void cancelSessionAsync({ sessionId: active.sessionId }).catch(() => undefined);
        }
        setPhase("setup");
        return;
      }

      setPreview({
        blob,
        source: "recording",
        durationMs: elapsed > 0 ? elapsed : null,
        width: size.width,
        height: size.height,
      });
      setPhase("preview");
    } finally {
      stoppingRef.current = false;
    }
  }, [cancelSessionAsync]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // --- Acquire → countdown → record --------------------------------------------

  const beginCapture = useCallback(
    async (active: ActiveSession, wsId: string) => {
      setPermissionIssue(null);
      const engine = new RecorderEngine({
        mode: settings.mode,
        micEnabled: settings.micEnabled,
        micDeviceId: settings.micDeviceId || undefined,
        cameraDeviceId: settings.cameraDeviceId || undefined,
        systemAudio: settings.systemAudio && settings.mode !== "camera",
        bubbleCorner: settings.bubbleCorner,
        bubbleSize: settings.bubbleSize,
        mimeType: active.mimeType,
        onChunk: (chunk, seq) => {
          void saveChunk(active.sessionId, seq, chunk).catch(() => undefined);
        },
        onScreenShareEnded: () => {
          const current = phaseRef.current;
          if (current === "recording") {
            toast.info("Screen sharing ended — wrapping up your recording.");
            void stopRecordingRef.current();
          } else if (current === "countdown" || current === "starting") {
            toast.info("Screen sharing ended before the recording started.");
            void discardActive({ silent: true });
          }
        },
        onError: (error) => {
          toast.error(error.message || "The recording hit an unexpected error.");
          if (phaseRef.current === "recording") void stopRecordingRef.current();
        },
      });
      engineRef.current = engine;

      try {
        await engine.acquire();
      } catch (error) {
        engineRef.current = null;
        if (error instanceof RecorderAcquireError) {
          pendingRetryRef.current = { session: active, workspaceId: wsId };
          setPermissionIssue(error);
          return;
        }
        toast.error(
          error instanceof Error ? error.message : "Could not access your recording devices.",
        );
        await discardActive({ silent: true });
        return;
      }

      pendingRetryRef.current = null;
      await saveSession({
        sessionId: active.sessionId,
        videoId: active.videoId,
        workspaceId: wsId,
        mimeType: engine.mimeType,
        startedAt: Date.now(),
        title: titleRef.current,
        bucket: active.bucket,
        uploadPath: active.uploadPath,
      }).catch(() => undefined);

      setCameraPreview(engine.cameraPreviewStream);
      setHasMic(settings.micEnabled);
      setMicOn(settings.micEnabled);
      setPaused(false);
      setElapsedMs(0);
      warnedRef.current = false;

      if (settings.countdownEnabled) {
        setPhase("countdown");
      } else {
        try {
          engine.start();
          setPhase("recording");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not start recording.");
          await discardActive({ silent: true });
        }
      }
    },
    [settings, discardActive],
  );

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "setup") return;
    if (!workspaceId) {
      toast.error("You need a workspace before you can record.");
      return;
    }
    if (!RecorderEngine.isSupported()) {
      toast.error("This browser can't record. Try the latest Chrome or Edge.");
      return;
    }
    setPhase("starting");
    const mimeType = pickSupportedMimeType();

    let active: ActiveSession;
    try {
      const created = await createSessionAsync({
        workspaceId,
        mode: settings.mode,
        mimeType,
        sourceUrl,
        title: initialTitle ?? undefined,
      });
      active = {
        sessionId: created.sessionId,
        videoId: created.videoId,
        bucket: created.bucket,
        uploadPath: created.uploadPath,
        mimeType,
        maxRecordingMinutes: created.limits.maxRecordingMinutes,
      };
    } catch (error) {
      setPhase("setup");
      toast.error(
        error instanceof Error ? error.message : "Could not start a recording session.",
      );
      return;
    }

    extraRecoveryKeyRef.current = null;
    setSession(active);
    sessionRef.current = active;
    setTitle(initialTitle ?? defaultRecordingTitle());
    await beginCapture(active, workspaceId);
  }, [workspaceId, settings.mode, sourceUrl, initialTitle, createSessionAsync, beginCapture]);

  const retryCapture = useCallback(() => {
    const pending = pendingRetryRef.current;
    setPermissionIssue(null);
    if (!pending) return;
    void beginCapture(pending.session, pending.workspaceId);
  }, [beginCapture]);

  const dismissPermission = useCallback(() => {
    void discardActive({ silent: true });
  }, [discardActive]);

  const handleCountdownComplete = useCallback(() => {
    if (phaseRef.current !== "countdown") return;
    const engine = engineRef.current;
    if (!engine) return;
    try {
      engine.start();
      setPhase("recording");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start recording.");
      void discardActive({ silent: true });
    }
  }, [discardActive]);

  const handleCountdownCancel = useCallback(() => {
    void discardActive({ silent: true }).then(() => toast.info("Recording canceled."));
  }, [discardActive]);

  // --- In-recording controls -----------------------------------------------------

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPaused) {
      engine.resume();
      setPaused(false);
    } else {
      engine.pause();
      setPaused(true);
    }
  }, []);

  const toggleMic = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.isMicEnabled;
    engine.setMicEnabled(next);
    setMicOn(next);
  }, []);

  const restartRecording = useCallback(async () => {
    const engine = engineRef.current;
    const active = sessionRef.current;
    if (!engine || !active || !workspaceId) return;
    try {
      await clearRecovery(active.sessionId).catch(() => undefined);
      await saveSession({
        sessionId: active.sessionId,
        videoId: active.videoId,
        workspaceId,
        mimeType: engine.mimeType,
        startedAt: Date.now(),
        title: titleRef.current,
        bucket: active.bucket,
        uploadPath: active.uploadPath,
      }).catch(() => undefined);
      warnedRef.current = false;
      engine.restart();
      setPaused(false);
      setElapsedMs(0);
      toast.info("Recording restarted from the top.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restart the recording.");
    }
  }, [workspaceId]);

  // --- Timer: elapsed, plan-limit warning at 80%, auto-stop at the cap ------------

  useEffect(() => {
    if (phase !== "recording") return;
    const limitMs =
      sessionRef.current?.maxRecordingMinutes != null
        ? sessionRef.current.maxRecordingMinutes * 60_000
        : null;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const elapsed = engine.getElapsedMs();
      setElapsedMs(elapsed);
      if (limitMs === null) return;
      if (!warnedRef.current && elapsed >= limitMs * 0.8 && elapsed < limitMs) {
        warnedRef.current = true;
        toast.warning(
          `${formatDuration(Math.max(0, limitMs - elapsed))} of recording time left on your plan.`,
        );
      }
      if (elapsed >= limitMs && !stoppingRef.current) {
        toast.info("You've reached your plan's recording limit — stopping now.");
        void stopRecordingRef.current();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  // Warn before closing the tab while capture is in flight (the preview panel
  // covers the upload phase itself).
  useEffect(() => {
    if (phase !== "recording" && phase !== "countdown" && phase !== "stopping") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  // --- Crash recovery --------------------------------------------------------------

  useEffect(() => {
    if (phase !== "setup") return;
    let cancelled = false;
    void listUnfinished().then((sessions) => {
      if (!cancelled) setRecoverySessions(sessions);
    });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const discardRecovered = useCallback(
    async (rec: RecoverySession, { silent = false }: { silent?: boolean } = {}) => {
      setRecoveryBusy(true);
      try {
        await cancelSessionAsync({ sessionId: rec.sessionId }).catch(() => undefined);
        await clearRecovery(rec.sessionId).catch(() => undefined);
        setRecoverySessions((current) => current.filter((s) => s.sessionId !== rec.sessionId));
        if (!silent) toast.info("Recovered recording discarded.");
      } finally {
        setRecoveryBusy(false);
      }
    },
    [cancelSessionAsync],
  );

  const resumeRecovered = useCallback(
    async (rec: RecoverySession) => {
      setRecoveryBusy(true);
      try {
        const blob = await loadRecording(rec.sessionId).catch(() => null);
        if (!blob || blob.size === 0) {
          toast.error("We couldn't rebuild that recording — its data is gone.");
          await discardRecovered(rec, { silent: true });
          return;
        }

        // Check the server-side session before reusing it: a stale recovery
        // entry may belong to a session that already completed (tab crashed
        // after completeSession but before clearRecovery) or was canceled —
        // startUpload rejects both, which would dead-end the preview panel.
        let reusable = false;
        if (rec.bucket && rec.uploadPath) {
          try {
            const server = await utils.recording.getSession.fetch({
              sessionId: rec.sessionId,
            });
            if (server.status === "completed") {
              await clearRecovery(rec.sessionId).catch(() => undefined);
              setRecoverySessions((current) =>
                current.filter((s) => s.sessionId !== rec.sessionId),
              );
              toast.info("That recording already uploaded — opening it.");
              router.push(`/app/video/${server.videoId ?? rec.videoId}`);
              return;
            }
            reusable = server.status !== "canceled";
          } catch {
            reusable = false;
          }
        }

        let active: ActiveSession;
        if (reusable && rec.bucket && rec.uploadPath) {
          active = {
            sessionId: rec.sessionId,
            videoId: rec.videoId,
            bucket: rec.bucket,
            uploadPath: rec.uploadPath,
            mimeType: rec.mimeType,
            maxRecordingMinutes: null,
          };
          extraRecoveryKeyRef.current = null;
        } else {
          // No reusable server session (legacy entry, canceled, or gone):
          // mint a fresh one and retire the orphan.
          const created = await createSessionAsync({
            workspaceId: rec.workspaceId,
            mode: "screen",
            mimeType: rec.mimeType,
            title: rec.title || undefined,
          });
          void cancelSessionAsync({ sessionId: rec.sessionId }).catch(() => undefined);
          extraRecoveryKeyRef.current = rec.sessionId;
          active = {
            sessionId: created.sessionId,
            videoId: created.videoId,
            bucket: created.bucket,
            uploadPath: created.uploadPath,
            mimeType: rec.mimeType,
            maxRecordingMinutes: created.limits.maxRecordingMinutes,
          };
        }

        setSession(active);
        sessionRef.current = active;
        setTitle(rec.title || defaultRecordingTitle());
        setPreview({ blob, source: "recovered", durationMs: null, width: null, height: null });
        setPhase("preview");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not recover that recording.",
        );
      } finally {
        setRecoveryBusy(false);
      }
    },
    [createSessionAsync, cancelSessionAsync, discardRecovered, utils, router],
  );

  // --- File upload ("or upload a video file") -----------------------------------------

  const handlePickFile = useCallback(
    async (file: File) => {
      if (!workspaceId) {
        toast.error("You need a workspace before you can upload.");
        return;
      }
      setFileBusy(true);
      try {
        const mimeType = (file.type || "video/mp4").slice(0, 100);
        const baseName = file.name.replace(/\.[^.]+$/, "").trim();
        const created = await createSessionAsync({
          workspaceId,
          mode: "screen",
          mimeType,
          title: baseName ? baseName.slice(0, 300) : undefined,
        });
        const active: ActiveSession = {
          sessionId: created.sessionId,
          videoId: created.videoId,
          bucket: created.bucket,
          uploadPath: created.uploadPath,
          mimeType,
          maxRecordingMinutes: created.limits.maxRecordingMinutes,
        };
        extraRecoveryKeyRef.current = null;
        setSession(active);
        sessionRef.current = active;
        setTitle(baseName || defaultRecordingTitle());
        setPreview({ blob: file, source: "file", durationMs: null, width: null, height: null });
        setPhase("preview");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not prepare the upload.",
        );
      } finally {
        setFileBusy(false);
      }
    },
    [workspaceId, createSessionAsync],
  );

  // --- Preview outcomes -----------------------------------------------------------------

  const handleUploaded = useCallback(
    (videoId: string) => {
      const extraKey = extraRecoveryKeyRef.current;
      if (extraKey) {
        extraRecoveryKeyRef.current = null;
        void clearRecovery(extraKey).catch(() => undefined);
      }
      router.push(`/app/video/${videoId}`);
    },
    [router],
  );

  const handleDiscardPreview = useCallback(() => {
    void discardActive();
  }, [discardActive]);

  // --- Derived ------------------------------------------------------------------------------

  const limitMs =
    session?.maxRecordingMinutes != null ? session.maxRecordingMinutes * 60_000 : null;
  const remainingMs = limitMs !== null ? Math.max(0, limitMs - elapsedMs) : null;
  const noWorkspace = workspaceList.isSuccess && (workspaceList.data?.length ?? 0) === 0;
  const isCapturePhase = phase === "countdown" || phase === "recording" || phase === "stopping";

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <Link href={workspaceId ? `/app/w/${workspaceId}` : "/app"}>
            <ArrowLeft className="h-4 w-4" />
            Back to library
          </Link>
        </Button>
        {workspaceName ? (
          <Badge variant="outline" className="max-w-56 gap-1.5 px-3 py-1.5 font-medium">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{workspaceName}</span>
          </Badge>
        ) : workspaceList.isLoading ? (
          <Skeleton className="h-7 w-36 rounded-full" />
        ) : null}
      </header>

      <main className="flex flex-1 flex-col px-4 pt-2 pb-28 sm:px-6">
        {(phase === "setup" || phase === "starting") && (
          <div className="mx-auto w-full max-w-xl space-y-5">
            <div className="space-y-1.5 text-center">
              <h1 className="text-2xl font-bold tracking-tight">New recording</h1>
              <p className="text-sm text-muted-foreground">
                Capture your screen, camera or both — then share it with a link in seconds.
              </p>
            </div>

            {noWorkspace && (
              <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
                You&apos;re not a member of any workspace yet.{" "}
                <Link href="/app" className="font-medium text-primary hover:underline">
                  Head to the app
                </Link>{" "}
                to create one, then come back to record.
              </div>
            )}

            <RecoveryBanner
              sessions={recoverySessions}
              busy={recoveryBusy}
              onResume={(rec) => void resumeRecovered(rec)}
              onDiscard={(rec) => void discardRecovered(rec)}
            />

            <SetupPanel
              settings={settings}
              onChange={handleSettingsChange}
              plan={plan}
              workspaceId={workspaceId}
              starting={phase === "starting"}
              onStart={() => void startRecording()}
            />

            <UploadFileCard busy={fileBusy} onPickFile={(file) => void handlePickFile(file)} />
          </div>
        )}

        {isCapturePhase && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            {phase === "stopping" ? (
              <>
                <Loader2 className="h-9 w-9 animate-spin text-primary" />
                <div>
                  <h1 className="text-xl font-semibold">Finishing your recording…</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Wrapping up the last frames — this only takes a moment.
                  </p>
                </div>
              </>
            ) : settings.mode === "camera" ? (
              <LiveCameraStage stream={cameraPreview} paused={paused} />
            ) : (
              <>
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-card/60 shadow-sm">
                  <Monitor className="h-9 w-9 text-muted-foreground" />
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
                    {!paused && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
                    )}
                    <span
                      className={
                        paused
                          ? "relative inline-flex h-4 w-4 rounded-full bg-amber-500 ring-2 ring-background"
                          : "relative inline-flex h-4 w-4 rounded-full bg-red-500 ring-2 ring-background"
                      }
                    />
                  </span>
                </div>
                <div>
                  <h1 className="text-xl font-semibold">
                    {paused ? "Recording paused" : "Recording your screen"}
                  </h1>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    {paused
                      ? "Press play in the control bar below when you're ready to continue."
                      : "Switch to the window or tab you're presenting — everything is being captured. Use the controls below to pause or stop."}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {phase === "preview" && preview && session && (
          <PreviewPanel
            blob={preview.blob}
            source={preview.source}
            durationMs={preview.durationMs}
            width={preview.width}
            height={preview.height}
            title={title}
            onTitleChange={setTitle}
            session={session}
            onUploaded={handleUploaded}
            onDiscard={handleDiscardPreview}
          />
        )}
      </main>

      {phase === "countdown" && (
        <CountdownOverlay onComplete={handleCountdownComplete} onCancel={handleCountdownCancel} />
      )}

      {phase === "recording" && (
        <>
          {settings.mode === "screen_camera" && (
            <CameraBubble
              stream={cameraPreview}
              corner={settings.bubbleCorner}
              size={settings.bubbleSize}
            />
          )}
          <RecordingControls
            elapsedMs={elapsedMs}
            remainingMs={remainingMs}
            paused={paused}
            micEnabled={micOn}
            hasMic={hasMic}
            onTogglePause={togglePause}
            onToggleMic={toggleMic}
            onStop={() => void stopRecording()}
            onRestart={() => void restartRecording()}
            onCancel={() => void discardActive()}
          />
        </>
      )}

      <PermissionDialog
        issue={permissionIssue}
        onRetry={retryCapture}
        onClose={dismissPermission}
      />
    </div>
  );
}

/** Large mirrored self-view shown while recording in camera-only mode. */
function LiveCameraStage({ stream, paused }: { stream: MediaStream | null; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative w-full max-w-3xl">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="aspect-video w-full -scale-x-100 rounded-xl border border-border bg-black object-cover shadow-2xl"
      />
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm">
          <p className="text-lg font-semibold">Paused</p>
        </div>
      )}
    </div>
  );
}
