"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  MonitorPlay,
  NotebookPen,
  PictureInPicture2,
  Sparkles,
  Timer,
  Video,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  BUBBLE_SIZES,
  type BubbleCorner,
  type BubbleSize,
  type RecordingMode,
} from "@/lib/recorder/engine";
import { type CanvasScene } from "@/lib/recorder/canvas-scene";
import { type RecorderEffects } from "@/lib/recorder/effects";
import { type PlanLimits } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { MicLevelMeter } from "./mic-level-meter";

export type RecorderSettings = {
  mode: RecordingMode;
  micEnabled: boolean;
  micDeviceId: string;
  cameraDeviceId: string;
  systemAudio: boolean;
  bubbleCorner: BubbleCorner;
  bubbleSize: BubbleSize;
  countdownEnabled: boolean;
  effects: RecorderEffects;
  canvas: CanvasScene;
};

const MODES: Array<{
  id: RecordingMode;
  label: string;
  description: string;
  icon: typeof Monitor;
}> = [
  { id: "screen", label: "Screen", description: "Just your screen", icon: Monitor },
  { id: "camera", label: "Camera", description: "Just your camera", icon: Video },
  {
    id: "screen_camera",
    label: "Screen + Cam",
    description: "Screen with camera bubble",
    icon: PictureInPicture2,
  },
];

const CORNERS: Array<{ id: BubbleCorner; label: string }> = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

const SIZE_LABELS: Record<BubbleSize, string> = { 160: "S", 220: "M", 320: "L" };

/**
 * Pre-recording setup: mode cards, device pickers with live previews,
 * audio/bubble/countdown options, plan banner and the start button.
 */
export function SetupPanel({
  settings,
  onChange,
  plan,
  workspaceId,
  starting,
  notesOpen,
  desktopAppDetected,
  preferDesktopApp,
  onPreferDesktopAppChange,
  onOpenEffects,
  onToggleNotes,
  onStart,
}: {
  settings: RecorderSettings;
  onChange: (patch: Partial<RecorderSettings>) => void;
  plan: PlanLimits | null;
  workspaceId: string | null;
  starting: boolean;
  notesOpen: boolean;
  /** The Ryloom desktop app has been seen on this machine. */
  desktopAppDetected: boolean;
  /** Start recording opens the desktop app instead of the browser recorder. */
  preferDesktopApp: boolean;
  onPreferDesktopAppChange: (preferred: boolean) => void;
  onOpenEffects: () => void;
  onToggleNotes: () => void;
  onStart: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const needsCamera = settings.mode !== "screen";
  const isScreenMode = settings.mode === "screen" || settings.mode === "screen_camera";

  const mics = useMemo(
    () => devices.filter((d) => d.kind === "audioinput" && d.deviceId),
    [devices],
  );
  const cameras = useMemo(
    () => devices.filter((d) => d.kind === "videoinput" && d.deviceId),
    [devices],
  );

  // Probe permissions once so enumerateDevices returns labels, then keep the
  // device list fresh on hot-plug.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const refresh = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (!cancelled) setDevices(list);
    };

    const probe = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // A missing camera shouldn't block mic access (and vice versa) —
        // retry each independently.
        try {
          const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
          audio.getTracks().forEach((track) => track.stop());
        } catch {
          // mic unavailable or blocked — the preview effect surfaces this
        }
        try {
          const video = await navigator.mediaDevices.getUserMedia({ video: true });
          video.getTracks().forEach((track) => track.stop());
        } catch {
          // camera unavailable or blocked
        }
      }
      await refresh();
    };

    void probe();
    const handleChange = () => void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", handleChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", handleChange);
    };
  }, []);

  // Default to the first available device once the list arrives (and heal
  // selections whose device was unplugged).
  useEffect(() => {
    const firstMic = mics[0];
    if (firstMic && (!settings.micDeviceId || !mics.some((m) => m.deviceId === settings.micDeviceId))) {
      onChange({ micDeviceId: firstMic.deviceId });
    }
    const firstCamera = cameras[0];
    if (
      firstCamera &&
      (!settings.cameraDeviceId || !cameras.some((c) => c.deviceId === settings.cameraDeviceId))
    ) {
      onChange({ cameraDeviceId: firstCamera.deviceId });
    }
  }, [mics, cameras, settings.micDeviceId, settings.cameraDeviceId, onChange]);

  // Live mic preview for the level meter.
  useEffect(() => {
    if (
      !settings.micEnabled ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setMicStream(null);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: settings.micDeviceId ? { exact: settings.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = stream;
        setMicStream(stream);
        setMicBlocked(false);
      })
      .catch(() => {
        if (!cancelled) {
          setMicStream(null);
          setMicBlocked(true);
        }
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setMicStream(null);
    };
  }, [settings.micEnabled, settings.micDeviceId]);

  // Live mirrored camera preview.
  useEffect(() => {
    if (!needsCamera || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraStream(null);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: settings.cameraDeviceId ? { exact: settings.cameraDeviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = stream;
        setCameraStream(stream);
        setCameraBlocked(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraStream(null);
          setCameraBlocked(true);
        }
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    };
  }, [needsCamera, settings.cameraDeviceId]);

  const limited = plan !== null && plan.maxRecordingMinutes !== null;

  return (
    <Card className="border-border/80 bg-card/60 shadow-xl">
      <CardContent className="space-y-6 p-6">
        {/* Mode picker */}
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((mode) => {
            const selected = settings.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChange({ mode: mode.id })}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary bg-accent ring-1 ring-primary"
                    : "border-border bg-card/40 hover:border-primary/40 hover:bg-accent/40",
                )}
                aria-pressed={selected}
              >
                <mode.icon
                  className={cn("h-6 w-6", selected ? "text-primary" : "text-muted-foreground")}
                />
                <div>
                  <p className="text-sm font-semibold">{mode.label}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                    {mode.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Camera preview */}
        {needsCamera && (
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
            {cameraStream ? (
              <CameraPreview stream={cameraStream} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <CameraOff className="h-7 w-7" />
                <p className="text-sm">
                  {cameraBlocked
                    ? "Camera is blocked — allow access in your browser's address bar"
                    : "Connecting to your camera…"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Camera select */}
        {needsCamera && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Camera className="h-4 w-4 text-muted-foreground" />
              Camera
            </Label>
            <Select
              value={settings.cameraDeviceId || undefined}
              onValueChange={(value) => onChange({ cameraDeviceId: value })}
              disabled={cameras.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={cameras.length === 0 ? "No camera found" : "Choose a camera"}
                />
              </SelectTrigger>
              <SelectContent className="dark">
                {cameras.map((camera, index) => (
                  <SelectItem key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Camera ${index + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Microphone */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm">
            <Mic className="h-4 w-4 text-muted-foreground" />
            Microphone
          </Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={settings.micEnabled ? "secondary" : "outline"}
              size="icon"
              onClick={() => onChange({ micEnabled: !settings.micEnabled })}
              title={settings.micEnabled ? "Turn microphone off" : "Turn microphone on"}
              aria-label={settings.micEnabled ? "Turn microphone off" : "Turn microphone on"}
              className={cn("shrink-0", !settings.micEnabled && "text-destructive")}
            >
              {settings.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              <Select
                value={settings.micDeviceId || undefined}
                onValueChange={(value) => onChange({ micDeviceId: value })}
                disabled={!settings.micEnabled || mics.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      !settings.micEnabled
                        ? "Microphone off"
                        : mics.length === 0
                          ? "No microphone found"
                          : "Choose a microphone"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="dark">
                  {mics.map((mic, index) => (
                    <SelectItem key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || `Microphone ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <MicLevelMeter stream={micStream} muted={!settings.micEnabled} />
          {settings.micEnabled && micBlocked && (
            <p className="text-xs text-destructive">
              Microphone is blocked — allow access in your browser&apos;s address bar.
            </p>
          )}
        </div>

        {/* System audio */}
        {isScreenMode && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <Label htmlFor="system-audio" className="text-sm font-medium">
                  System audio
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Capture tab or system sound — enable audio sharing in the screen picker.
                </p>
              </div>
            </div>
            <Switch
              id="system-audio"
              checked={settings.systemAudio}
              onCheckedChange={(checked) => onChange({ systemAudio: checked })}
            />
          </div>
        )}

        {/* Camera bubble options */}
        {settings.mode === "screen_camera" && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Camera bubble</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Position and size on screen</p>
            </div>
            <div className="flex items-center gap-4">
              <div
                className="grid h-14 w-22 grid-cols-2 grid-rows-2 gap-1 rounded-lg border border-border bg-muted/30 p-1.5"
                role="radiogroup"
                aria-label="Bubble corner"
              >
                {CORNERS.map((corner) => {
                  const selected = settings.bubbleCorner === corner.id;
                  return (
                    <button
                      key={corner.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={corner.label}
                      onClick={() => onChange({ bubbleCorner: corner.id })}
                      className={cn(
                        "flex items-center justify-center rounded-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "bg-primary/20" : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          selected ? "bg-primary" : "bg-muted-foreground/40",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Bubble size">
                {BUBBLE_SIZES.map((size) => {
                  const selected = settings.bubbleSize === size;
                  return (
                    <Button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      className="w-9"
                      title={`${size}px bubble`}
                      onClick={() => onChange({ bubbleSize: size })}
                    >
                      {SIZE_LABELS[size]}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Desktop app priority — shown once the app has been seen on this
            machine. On = "Start recording" hands the whole take to the app
            (true always-on-top bubble, controls invisible to the capture). */}
        {desktopAppDetected && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <Label htmlFor="desktop-app" className="text-sm font-medium">
                  Record with the desktop app
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Opens Ryloom on your computer — best quality, true floating camera bubble.
                </p>
              </div>
            </div>
            <Switch
              id="desktop-app"
              checked={preferDesktopApp}
              onCheckedChange={onPreferDesktopAppChange}
            />
          </div>
        )}

        {/* Countdown */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <Timer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <Label htmlFor="countdown" className="text-sm font-medium">
                Countdown
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                3-second countdown before recording starts
              </p>
            </div>
          </div>
          <Switch
            id="countdown"
            checked={settings.countdownEnabled}
            onCheckedChange={(checked) => onChange({ countdownEnabled: checked })}
          />
        </div>

        {/* Effects + speaker notes (desktop-app feature row) */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            className="relative h-11 gap-2"
            onClick={onOpenEffects}
          >
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Effects
            {(settings.effects.cameraBackground !== "none" || settings.canvas.enabled) && (
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </Button>
          <Button
            type="button"
            variant={notesOpen ? "secondary" : "outline"}
            className="h-11 gap-2"
            onClick={onToggleNotes}
          >
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            Notes
          </Button>
        </div>

        {/* Plan banner */}
        {plan && limited && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
            <p className="text-sm">
              <span className="font-semibold">{plan.name} plan</span>
              <span className="text-muted-foreground">
                {" "}
                — recordings up to {plan.maxRecordingMinutes} min, processed at{" "}
                {plan.maxResolution}p
              </span>
            </p>
            {workspaceId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/app/w/${workspaceId}/settings/billing`}>Upgrade</Link>
              </Button>
            )}
          </div>
        )}
        {plan && !limited && (
          <p className="text-xs text-muted-foreground">
            {plan.name} plan — unlimited recording length, processed up to {plan.maxResolution}p.
          </p>
        )}

        <Button
          size="lg"
          className="h-12 w-full gap-2.5 text-base font-semibold"
          onClick={onStart}
          disabled={starting || !workspaceId}
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white/70" />
          )}
          {starting ? "Starting…" : "Start recording"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CameraPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      className="h-full w-full -scale-x-100 object-cover"
    />
  );
}
