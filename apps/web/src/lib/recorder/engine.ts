/**
 * RecorderEngine — owns every browser media primitive behind the /record page:
 * stream acquisition, canvas compositing for screen+camera, WebAudio mixing,
 * MediaRecorder chunking, pause/resume accounting and teardown.
 *
 * The engine is UI-agnostic: the page reacts to the callbacks passed in the
 * config and polls `getElapsedMs()` / `getMicLevel()` on its own cadence.
 * Every method that touches `navigator.mediaDevices` is only ever called from
 * client event handlers/effects.
 */

import { CameraBackgroundProcessor } from "./camera-background";
import {
  DEFAULT_CANVAS_SCENE,
  paintCanvasScene,
  type CanvasScene,
} from "./canvas-scene";
import {
  DEFAULT_EFFECTS,
  FRAME_GRADIENT_STOPS,
  PADDING_FRACTIONS,
  type RecorderEffects,
} from "./effects";

export type RecordingMode = "screen" | "camera" | "screen_camera";

export type BubbleCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** S/M/L presets — must match the desktop bubble (bubble.html SIZES). */
export type BubbleSize = 160 | 220 | 320;

export const BUBBLE_SIZES: readonly BubbleSize[] = [160, 220, 320] as const;

/** Bubble center as a fraction of the output frame (0..1 on both axes). */
export type BubblePosition = { x: number; y: number };

/** Where a corner preset places the bubble center, normalized. */
export function cornerToPosition(corner: BubbleCorner): BubblePosition {
  return {
    x: corner.endsWith("right") ? 0.9 : 0.1,
    y: corner.startsWith("bottom") ? 0.84 : 0.16,
  };
}

/** Preference-ordered container/codec candidates — the first supported wins. */
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function pickSupportedMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "video/webm";
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "video/webm";
}

export function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "video/mp4") return "mp4";
  if (base === "video/quicktime") return "mov";
  if (base === "video/x-matroska") return "mkv";
  if (base === "audio/webm") return "weba";
  return "webm";
}

// ---------------------------------------------------------------------------
// Acquisition errors — typed so the UI can render a friendly retry modal.
// ---------------------------------------------------------------------------

export type AcquireErrorKind = "permission" | "not-found" | "busy" | "unsupported" | "unknown";
export type AcquireDevice = "screen" | "camera" | "microphone";

export class RecorderAcquireError extends Error {
  readonly kind: AcquireErrorKind;
  readonly device: AcquireDevice;

  constructor(device: AcquireDevice, kind: AcquireErrorKind, message: string) {
    super(message);
    this.name = "RecorderAcquireError";
    this.device = device;
    this.kind = kind;
  }
}

const PERMISSION_MESSAGES: Record<AcquireDevice, string> = {
  screen:
    "Screen sharing was declined. Pick the screen, window or tab you want to record when the picker appears.",
  camera:
    "Camera access is blocked. Allow camera access for this site in your browser's address bar, then try again.",
  microphone:
    "Microphone access is blocked. Allow microphone access for this site in your browser's address bar, then try again.",
};

const NOT_FOUND_MESSAGES: Record<AcquireDevice, string> = {
  screen: "No screen was available to capture.",
  camera: "We couldn't find that camera. It may have been unplugged.",
  microphone: "We couldn't find that microphone. It may have been unplugged.",
};

const BUSY_MESSAGES: Record<AcquireDevice, string> = {
  screen: "Screen capture was interrupted before it could start.",
  camera: "Your camera is busy — another app may be using it. Close it and try again.",
  microphone: "Your microphone is busy — another app may be using it. Close it and try again.",
};

function toAcquireError(device: AcquireDevice, error: unknown): RecorderAcquireError {
  if (error instanceof RecorderAcquireError) return error;
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return new RecorderAcquireError(device, "permission", PERMISSION_MESSAGES[device]);
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return new RecorderAcquireError(device, "not-found", NOT_FOUND_MESSAGES[device]);
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return new RecorderAcquireError(device, "busy", BUSY_MESSAGES[device]);
  }
  return new RecorderAcquireError(
    device,
    "unknown",
    `Could not access your ${device}. ${error instanceof Error ? error.message : ""}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export type RecorderEngineConfig = {
  mode: RecordingMode;
  /** Whether the microphone should be captured at all. */
  micEnabled: boolean;
  /** Specific input device ids; omit for the system default. */
  micDeviceId?: string;
  cameraDeviceId?: string;
  /** Capture tab/system audio alongside the screen (screen modes only). */
  systemAudio: boolean;
  /** Initial bubble center, normalized to the output frame. */
  bubblePosition: BubblePosition;
  bubbleSize: BubbleSize;
  /** Camera background / bubble-frame / inset effects (desktop-app parity). */
  effects: RecorderEffects;
  /** Loom-style canvas backdrop (Effects → Canvas). */
  canvasScene?: CanvasScene;
  mimeType: string;
  /** Fires once per ~1s timeslice with the chunk and its sequence number. */
  onChunk: (chunk: Blob, seq: number) => void;
  /** The user clicked the browser's native "Stop sharing" — auto-stop. */
  onScreenShareEnded?: () => void;
  onError?: (error: Error) => void;
  /** Non-fatal effect problems (e.g. the segmentation model failed to load). */
  onEffectsWarning?: (message: string) => void;
};

export class RecorderEngine {
  private readonly config: RecorderEngineConfig;

  private screenStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private canvasStream: MediaStream | null = null;
  private outputStream: MediaStream | null = null;

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private screenVideo: HTMLVideoElement | null = null;
  private cameraVideo: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private hiddenDrawTimer: number | null = null;
  private lastDrawAt = 0;

  private bubblePosition: BubblePosition;
  private bubbleSize: BubbleSize;
  private effects: RecorderEffects;
  private canvasScene: CanvasScene;
  /** Applies Clear/Blur/replacement backgrounds to the camera stream. */
  private cameraProcessor: CameraBackgroundProcessor | null = null;
  /**
   * Whether drawCompositeFrame paints the camera bubble. Turned off when the
   * in-page bubble is itself part of the captured pixels (probed at start) —
   * otherwise the recording would show the bubble twice.
   */
  private bubbleCompositing = true;

  private recorder: MediaRecorder | null = null;
  private actualMimeType: string;
  private chunks: Blob[] = [];
  private chunkSeq = 0;

  private startedAtMs: number | null = null;
  private pausedAtMs: number | null = null;
  private stoppedAtMs: number | null = null;
  private totalPausedMs = 0;
  private micOn: boolean;
  private outputSize: { width: number | null; height: number | null } = {
    width: null,
    height: null,
  };

  constructor(config: RecorderEngineConfig) {
    this.config = config;
    this.actualMimeType = config.mimeType;
    this.bubblePosition = config.bubblePosition;
    this.bubbleSize = config.bubbleSize;
    this.effects = config.effects ?? DEFAULT_EFFECTS;
    this.canvasScene = config.canvasScene ?? DEFAULT_CANVAS_SCENE;
    this.micOn = config.micEnabled;
  }

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  get mimeType(): string {
    return this.actualMimeType;
  }

  /**
   * Live camera stream for self-views (in-page bubble, PiP bubble, stage).
   * Already background-processed, so previews match the recording exactly.
   */
  get cameraPreviewStream(): MediaStream | null {
    return this.cameraProcessor?.stream ?? this.cameraStream;
  }

  /** Raw screen stream — used by the self-view capture probe before start(). */
  get screenCaptureStream(): MediaStream | null {
    return this.screenStream;
  }

  /** What the user picked in the share picker: monitor | window | browser. */
  get screenDisplaySurface(): string | null {
    const track = this.screenStream?.getVideoTracks()[0];
    const surface = track?.getSettings().displaySurface;
    return typeof surface === "string" ? surface : null;
  }

  get isMicEnabled(): boolean {
    return this.micOn;
  }

  get isPaused(): boolean {
    return this.recorder?.state === "paused";
  }

  // -------------------------------------------------------------------------
  // Acquisition
  // -------------------------------------------------------------------------

  async acquire(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      throw new RecorderAcquireError("screen", "unsupported", "This browser can't capture media.");
    }
    const { mode } = this.config;

    if (mode === "screen" || mode === "screen_camera") {
      if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
        throw new RecorderAcquireError(
          "screen",
          "unsupported",
          "Screen capture isn't supported in this browser. Try Chrome or Edge.",
        );
      }
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: this.config.systemAudio,
        });
      } catch (error) {
        this.releaseMedia();
        throw toAcquireError("screen", error);
      }
      const screenTrack = this.screenStream.getVideoTracks()[0];
      screenTrack?.addEventListener("ended", () => {
        this.config.onScreenShareEnded?.();
      });
    }

    if (mode === "camera" || mode === "screen_camera") {
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: this.config.cameraDeviceId
              ? { exact: this.config.cameraDeviceId }
              : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (error) {
        this.releaseMedia();
        throw toAcquireError("camera", error);
      }
      // Every camera consumer (bubble, PiP, recording) sees the processed
      // stream, so Clear/Blur/replacement switches live everywhere at once.
      this.cameraProcessor = new CameraBackgroundProcessor(
        this.cameraStream,
        this.effects.cameraBackground,
      );
      this.cameraProcessor.onLoadError = () => {
        this.config.onEffectsWarning?.(
          "Camera backgrounds aren't available right now — the segmentation model couldn't load.",
        );
      };
    }

    if (this.config.micEnabled) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: this.config.micDeviceId ? { exact: this.config.micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (error) {
        this.releaseMedia();
        throw toAcquireError("microphone", error);
      }
    }

    const videoTrack = await this.buildVideoTrack();
    const audioTrack = this.buildMixedAudioTrack();

    const tracks: MediaStreamTrack[] = [];
    if (videoTrack) tracks.push(videoTrack);
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) {
      this.releaseMedia();
      throw new RecorderAcquireError("screen", "unknown", "No media was available to record.");
    }
    this.outputStream = new MediaStream(tracks);

    if (this.canvas) {
      this.outputSize = { width: this.canvas.width, height: this.canvas.height };
    } else {
      const settings = videoTrack?.getSettings();
      this.outputSize = {
        width: settings?.width ? Math.round(settings.width) : null,
        height: settings?.height ? Math.round(settings.height) : null,
      };
    }
  }

  private async buildVideoTrack(): Promise<MediaStreamTrack | null> {
    const { mode } = this.config;

    // Camera-only always composites (16:9 frame) so the Loom-style canvas
    // backdrop can be toggled/edited live at any point of the recording.
    let width: number;
    let height: number;
    if (mode === "camera") {
      if (!this.cameraStream) return null;
      width = 1920;
      height = 1080;
    } else {
      // Plain screen capture stays a zero-cost raw track unless the canvas
      // backdrop needs the compositor at start.
      if (mode === "screen" && !this.canvasScene.enabled) {
        return this.screenStream?.getVideoTracks()[0] ?? null;
      }

      // Composite the camera bubble and/or canvas backdrop over the screen on
      // an offscreen canvas sized to the captured screen.
      if (!this.screenStream) return null;
      if (mode === "screen_camera" && !this.cameraStream) return null;
      const screenTrack = this.screenStream.getVideoTracks()[0];
      const settings = screenTrack?.getSettings();
      width = Math.max(2, Math.round(settings?.width ?? 1920));
      height = Math.max(2, Math.round(settings?.height ?? 1080));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new RecorderAcquireError(
        "screen",
        "unsupported",
        "Canvas rendering isn't available in this browser.",
      );
    }
    this.canvas = canvas;
    this.canvasCtx = ctx;

    if (this.screenStream) {
      this.screenVideo = await this.attachHiddenVideo(this.screenStream);
    }
    if (this.cameraProcessor) {
      this.cameraVideo = await this.attachHiddenVideo(this.cameraProcessor.stream);
    } else if (this.cameraStream) {
      this.cameraVideo = await this.attachHiddenVideo(this.cameraStream);
    }

    this.drawCompositeFrame();
    const loop = () => {
      this.drawCompositeFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
    // rAF throttles (or halts) in hidden tabs — exactly where a screen
    // recorder lives while the user works elsewhere. A timer keeps the
    // composite alive whenever rAF goes quiet.
    this.hiddenDrawTimer = window.setInterval(() => {
      if (performance.now() - this.lastDrawAt > 80) this.drawCompositeFrame();
    }, 66);

    this.canvasStream = canvas.captureStream(30);
    return this.canvasStream.getVideoTracks()[0] ?? null;
  }

  private async attachHiddenVideo(stream: MediaStream): Promise<HTMLVideoElement> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    return video;
  }

  private drawCompositeFrame(): void {
    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    if (!canvas || !ctx) return;
    this.lastDrawAt = performance.now();
    const w = canvas.width;
    const h = canvas.height;
    const mode = this.config.mode;
    const scene = this.canvasScene.enabled ? this.canvasScene : null;
    const screenVideo = this.screenVideo;

    // 1. Backdrop: the canvas scene (full page with text in camera mode,
    //    wallpaper-only in screen modes — text would hide behind the screen)
    //    or plain black.
    if (scene && mode === "camera") {
      paintCanvasScene(ctx, w, h, scene);
    } else if (scene) {
      paintCanvasScene(ctx, w, h, { ...scene, layout: "empty" });
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Content — screen modes: full-bleed normally, inset with padding,
    //    rounded corners and a drop shadow over an active canvas backdrop.
    //    The content rect also anchors the bubble: its normalized position is
    //    relative to the SCREEN pixels (where the presenter dragged it), so
    //    when the screen is inset the bubble must follow it.
    //    Camera mode without a canvas: the camera fills the frame instead.
    let contentX = 0;
    let contentY = 0;
    let contentW = w;
    let contentH = h;
    if (mode !== "camera") {
      if (!screenVideo) return;
      if (scene) {
        const pad = PADDING_FRACTIONS[this.effects.padding] * Math.min(w, h);
        const sw = screenVideo.videoWidth || w;
        const sh = screenVideo.videoHeight || h;
        const fit = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
        contentW = Math.max(2, sw * fit);
        contentH = Math.max(2, sh * fit);
        contentX = (w - contentW) / 2;
        contentY = (h - contentH) / 2;
      }
      if (screenVideo.readyState >= 2) {
        if (scene) {
          const radius =
            this.effects.corners === "rounded" ? Math.max(8, Math.min(w, h) * 0.02) : 0;

          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
          ctx.shadowBlur = Math.min(w, h) * 0.04;
          ctx.shadowOffsetY = Math.min(w, h) * 0.012;
          ctx.fillStyle = "#000000";
          roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
          ctx.fill();
          ctx.restore();

          ctx.save();
          roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
          ctx.clip();
          ctx.drawImage(screenVideo, contentX, contentY, contentW, contentH);
          ctx.restore();
        } else {
          ctx.drawImage(screenVideo, 0, 0, w, h);
        }
      }
    } else if (!scene) {
      // Camera stage without a canvas — cover-fit the camera, no bubble ring.
      const video = this.cameraVideo;
      if (video && video.readyState >= 2) {
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const cover = Math.max(w / vw, h / vh);
        const cw = vw * cover;
        const ch = vh * cover;
        ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch);
      }
      return;
    }

    // 3. Camera bubble (screen_camera always, and camera mode over a canvas).
    if (mode === "screen") return;
    const cameraVideo = this.cameraVideo;
    if (!this.bubbleCompositing || !cameraVideo || cameraVideo.readyState < 2) return;

    // Bubble sizes are tuned for ~1080p output; scale up proportionally when
    // the captured screen is larger so the bubble never looks tiny on 4K.
    const scale = Math.max(1, contentW / 1920);
    const diameter = this.bubbleSize * scale;
    const radius = diameter / 2;
    const cx = clamp(contentX + this.bubblePosition.x * contentW, radius, w - radius);
    const cy = clamp(contentY + this.bubblePosition.y * contentH, radius, h - radius);
    const frame = this.effects.frame;

    const clipPath = () => {
      ctx.beginPath();
      if (frame === "square") {
        roundRectPath(ctx, cx - radius, cy - radius, diameter, diameter, diameter * 0.22);
      } else {
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.closePath();
      }
    };

    ctx.save();
    clipPath();
    ctx.clip();
    const vw = cameraVideo.videoWidth || 1280;
    const vh = cameraVideo.videoHeight || 720;
    const side = Math.min(vw, vh);
    ctx.drawImage(
      cameraVideo,
      (vw - side) / 2,
      (vh - side) / 2,
      side,
      side,
      cx - radius,
      cy - radius,
      diameter,
      diameter,
    );
    ctx.restore();

    // Frame ring (Effects → Frames) — matches the desktop bubble styles.
    if (frame === "none") return;
    ctx.save();
    ctx.lineWidth = Math.max(3, 4 * scale);
    if (frame === "gradient") {
      const gradient = ctx.createLinearGradient(
        cx - radius,
        cy - radius,
        cx + radius,
        cy + radius,
      );
      gradient.addColorStop(0, FRAME_GRADIENT_STOPS[0]);
      gradient.addColorStop(1, FRAME_GRADIENT_STOPS[1]);
      ctx.strokeStyle = gradient;
    } else {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    }
    const inset = ctx.lineWidth / 2;
    ctx.beginPath();
    if (frame === "square") {
      roundRectPath(
        ctx,
        cx - radius + inset,
        cy - radius + inset,
        diameter - inset * 2,
        diameter - inset * 2,
        (diameter - inset * 2) * 0.22,
      );
    } else {
      ctx.arc(cx, cy, radius - inset, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  private buildMixedAudioTrack(): MediaStreamTrack | null {
    const micTrack = this.micStream?.getAudioTracks()[0] ?? null;
    const systemTrack = this.screenStream?.getAudioTracks()[0] ?? null;
    if (!micTrack && !systemTrack) return null;

    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    // acquire() always runs from a click handler, but resume defensively.
    void audioContext.resume().catch(() => undefined);
    const destination = audioContext.createMediaStreamDestination();

    if (micTrack) {
      const micSource = audioContext.createMediaStreamSource(new MediaStream([micTrack]));
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      micSource.connect(analyser);
      micSource.connect(destination);
      this.analyser = analyser;
      this.analyserData = new Uint8Array(analyser.fftSize);
    }
    if (systemTrack) {
      const systemSource = audioContext.createMediaStreamSource(new MediaStream([systemTrack]));
      systemSource.connect(destination);
    }
    return destination.stream.getAudioTracks()[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Recording lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (!this.outputStream) {
      throw new Error("Streams not acquired — call acquire() before start().");
    }
    if (this.recorder) return;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.outputStream, {
        mimeType: this.actualMimeType,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      // Extremely defensive — the mime type was checked with isTypeSupported.
      recorder = new MediaRecorder(this.outputStream);
    }
    if (recorder.mimeType) this.actualMimeType = recorder.mimeType;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        const seq = this.chunkSeq;
        this.chunkSeq += 1;
        this.chunks.push(event.data);
        this.config.onChunk(event.data, seq);
      }
    };
    recorder.onerror = () => {
      this.config.onError?.(new Error("The recorder hit an unexpected error."));
    };

    this.recorder = recorder;
    recorder.start(1000);
    this.startedAtMs = performance.now();
    this.setMicEnabled(this.micOn);
  }

  pause(): void {
    if (this.recorder?.state !== "recording") return;
    this.recorder.pause();
    this.pausedAtMs = performance.now();
  }

  resume(): void {
    if (this.recorder?.state !== "paused") return;
    this.recorder.resume();
    if (this.pausedAtMs !== null) {
      this.totalPausedMs += performance.now() - this.pausedAtMs;
    }
    this.pausedAtMs = null;
  }

  /** Stops the recorder, waits for the final chunk and releases all media. */
  async stop(): Promise<Blob> {
    this.markStopped();
    const recorder = this.recorder;
    this.recorder = null;

    const finalize = (): Blob => {
      const blob = new Blob(this.chunks, { type: this.actualMimeType });
      this.releaseMedia();
      return blob;
    };

    if (!recorder || recorder.state === "inactive") return finalize();

    return new Promise<Blob>((resolve) => {
      const fallback = window.setTimeout(() => resolve(finalize()), 5000);
      recorder.onstop = () => {
        window.clearTimeout(fallback);
        resolve(finalize());
      };
      try {
        recorder.stop();
      } catch {
        window.clearTimeout(fallback);
        resolve(finalize());
      }
    });
  }

  /**
   * Discards everything captured so far and starts a fresh recording on the
   * same already-acquired streams — no new permission prompts or screen picker.
   */
  restart(): void {
    this.resetForRetake();
    this.start();
  }

  /**
   * Discards the current take but does NOT start recording — used when the
   * 3-2-1 countdown should run again before the retake (desktop parity).
   * Streams stay live; call start() when the countdown finishes.
   */
  resetForRetake(): void {
    if (!this.outputStream) {
      throw new Error("Streams not acquired — call acquire() before restart().");
    }
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.chunks = [];
    this.chunkSeq = 0;
    this.startedAtMs = null;
    this.pausedAtMs = null;
    this.stoppedAtMs = null;
    this.totalPausedMs = 0;
  }

  /** Abandons the recording: stops everything and drops buffered chunks. */
  destroy(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.markStopped();
    this.releaseMedia();
    this.chunks = [];
  }

  private markStopped(): void {
    if (this.startedAtMs !== null && this.stoppedAtMs === null) {
      this.stoppedAtMs = this.pausedAtMs ?? performance.now();
    }
  }

  private releaseMedia(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.hiddenDrawTimer !== null) {
      window.clearInterval(this.hiddenDrawTimer);
      this.hiddenDrawTimer = null;
    }
    this.cameraProcessor?.destroy();
    this.cameraProcessor = null;
    for (const stream of [
      this.canvasStream,
      this.outputStream,
      this.screenStream,
      this.cameraStream,
      this.micStream,
    ]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.canvasStream = null;
    this.outputStream = null;
    this.screenStream = null;
    this.cameraStream = null;
    this.micStream = null;
    if (this.screenVideo) {
      this.screenVideo.srcObject = null;
      this.screenVideo = null;
    }
    if (this.cameraVideo) {
      this.cameraVideo.srcObject = null;
      this.cameraVideo = null;
    }
    this.canvas = null;
    this.canvasCtx = null;
    this.analyser = null;
    this.analyserData = null;
    const audioContext = this.audioContext;
    this.audioContext = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Live state
  // -------------------------------------------------------------------------

  /** Wall-clock recording time in ms, excluding time spent paused. */
  getElapsedMs(): number {
    if (this.startedAtMs === null) return 0;
    const end = this.stoppedAtMs ?? this.pausedAtMs ?? performance.now();
    return Math.max(0, end - this.startedAtMs - this.totalPausedMs);
  }

  /** Output dimensions captured at acquire time (survives teardown). */
  getOutputSize(): { width: number | null; height: number | null } {
    return this.outputSize;
  }

  /** RMS microphone level, 0..1 (0 when muted or no mic). */
  getMicLevel(): number {
    const analyser = this.analyser;
    const data = this.analyserData;
    if (!analyser || !data || !this.micOn) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = ((data[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  /** Mutes/unmutes the microphone mid-recording without removing the track. */
  setMicEnabled(enabled: boolean): void {
    this.micOn = enabled;
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  /**
   * Live-moves the composited bubble — wired to the in-page bubble's drag so
   * the recording tracks exactly where the presenter put it.
   */
  setBubblePosition(position: BubblePosition): void {
    this.bubblePosition = {
      x: clamp(position.x, 0, 1),
      y: clamp(position.y, 0, 1),
    };
  }

  /** Live-resizes the composited bubble (S/M/L on the bubble's hover pill). */
  setBubbleSize(size: BubbleSize): void {
    this.bubbleSize = size;
  }

  /**
   * Live-updates effects — camera backgrounds switch instantly everywhere
   * (bubble, PiP and recording all consume the processed stream).
   */
  setEffects(effects: RecorderEffects): void {
    this.effects = effects;
    this.cameraProcessor?.setBackground(effects.cameraBackground);
  }

  /**
   * Live-updates the canvas backdrop (background, layout, text edits). The
   * compositor reads it on the next frame, so stage edits stream straight
   * into the recording. Screen-only recordings need the canvas enabled before
   * start — without it the raw screen track is recorded compositor-free.
   */
  setCanvasScene(scene: CanvasScene): void {
    this.canvasScene = scene;
  }

  /**
   * Enables/disables drawing the camera bubble into the composite. Disabled
   * when the in-page bubble is burned into the screen capture itself, so the
   * recording shows exactly one bubble.
   */
  setBubbleCompositing(enabled: boolean): void {
    this.bubbleCompositing = enabled;
  }

  get isBubbleCompositing(): boolean {
    return this.bubbleCompositing;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** ctx.roundRect with a rect fallback for engines that lack it. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.beginPath();
  if (radius > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.rect(x, y, w, h);
  }
}
