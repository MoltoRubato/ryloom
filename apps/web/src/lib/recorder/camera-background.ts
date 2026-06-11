/**
 * CameraBackgroundProcessor — turns a raw camera MediaStream into a processed
 * stream whose background can be cleared, blurred or replaced live.
 *
 * Pipeline: MediaPipe ImageSegmenter (selfie segmentation, WASM runtime served
 * from /mediapipe/wasm, model from /models/selfie_segmenter.tflite) produces a
 * per-frame person confidence mask. Each output frame is composed on a canvas:
 * background layer (raw frame, blurred frame, or a gradient painter), then the
 * person cut out via the mask drawn on top. The canvas stream is what every
 * consumer sees — the in-page bubble, the PiP bubble and the recording — so a
 * background change is instantly visible everywhere, including mid-recording.
 *
 * With "none" selected the processor cheaply passes frames through, which
 * keeps the output track stable (MediaRecorder can't swap tracks mid-flight)
 * while still allowing a live switch to blur/replacement at any moment.
 */

import { BACKGROUND_PAINTERS, type CameraBackgroundId } from "./effects";

const OUTPUT_FPS = 30;
/** Re-draw watchdog cadence — keeps frames flowing when rAF throttles. */
const HIDDEN_TICK_MS = 66;
const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/selfie_segmenter.tflite";

type Segmenter = {
  segmentForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
    callback: (result: SegmenterResult) => void,
  ) => void;
  close: () => void;
};

type SegmenterResult = {
  confidenceMasks?: Array<{
    width: number;
    height: number;
    getAsFloat32Array: () => Float32Array;
  }>;
};

export class CameraBackgroundProcessor {
  private readonly source: MediaStream;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Person cut-out scratch layer (frame ∩ mask). */
  private readonly personCanvas: HTMLCanvasElement;
  private readonly personCtx: CanvasRenderingContext2D;
  /** Low-res alpha mask straight from the segmenter. */
  private readonly maskCanvas: HTMLCanvasElement;
  private readonly maskCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  private hasMask = false;

  private readonly outputStream: MediaStream;
  private background: CameraBackgroundId;

  private segmenter: Segmenter | null = null;
  private segmenterLoading: Promise<void> | null = null;
  private segmenterFailed = false;
  private lastVideoTime = -1;

  private rafId: number | null = null;
  private tickTimer: number | null = null;
  private lastDrawAt = 0;
  private destroyed = false;

  /** Fired once if the segmentation runtime can't be loaded. */
  onLoadError: ((error: Error) => void) | null = null;

  constructor(source: MediaStream, background: CameraBackgroundId) {
    this.source = source;
    this.background = background;

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream(source.getVideoTracks());
    void this.video.play().catch(() => undefined);

    const settings = source.getVideoTracks()[0]?.getSettings();
    const width = Math.max(2, Math.round(settings?.width ?? 1280));
    const height = Math.max(2, Math.round(settings?.height ?? 720));

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D isn't available in this browser.");
    this.ctx = ctx;

    this.personCanvas = document.createElement("canvas");
    this.personCanvas.width = width;
    this.personCanvas.height = height;
    this.personCtx = this.personCanvas.getContext("2d") as CanvasRenderingContext2D;

    this.maskCanvas = document.createElement("canvas");
    this.maskCanvas.width = 256;
    this.maskCanvas.height = 256;
    this.maskCtx = this.maskCanvas.getContext("2d") as CanvasRenderingContext2D;

    // First frame before captureStream so the track is never blank.
    this.drawFrame();
    this.outputStream = this.canvas.captureStream(OUTPUT_FPS);

    const loop = () => {
      this.drawFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
    // rAF throttles (or halts) in hidden tabs — exactly where a recorder
    // lives while the presenter works elsewhere. The timer keeps frames
    // flowing whenever rAF goes quiet.
    this.tickTimer = window.setInterval(() => {
      if (performance.now() - this.lastDrawAt > 80) this.drawFrame();
    }, HIDDEN_TICK_MS);

    if (background !== "none") this.ensureSegmenter();
  }

  /** The processed camera stream — feed this everywhere instead of the raw one. */
  get stream(): MediaStream {
    return this.outputStream;
  }

  setBackground(background: CameraBackgroundId): void {
    this.background = background;
    if (background !== "none") this.ensureSegmenter();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.outputStream.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.segmenter?.close();
    this.segmenter = null;
  }

  /** Lazily loads the WASM runtime + model the first time it's needed. */
  private ensureSegmenter(): void {
    if (this.segmenter || this.segmenterLoading || this.segmenterFailed) return;
    this.segmenterLoading = (async () => {
      try {
        const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        const create = (delegate: "GPU" | "CPU") =>
          ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate },
            runningMode: "VIDEO",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
        let segmenter;
        try {
          segmenter = await create("GPU");
        } catch {
          segmenter = await create("CPU");
        }
        if (this.destroyed) {
          segmenter.close();
          return;
        }
        this.segmenter = segmenter as unknown as Segmenter;
      } catch (error) {
        this.segmenterFailed = true;
        console.warn("[camera-background] segmentation unavailable:", error);
        this.onLoadError?.(
          error instanceof Error ? error : new Error("Could not load the segmentation model."),
        );
      } finally {
        this.segmenterLoading = null;
      }
    })();
  }

  private drawFrame(): void {
    if (this.destroyed) return;
    this.lastDrawAt = performance.now();
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    // Track real camera dimensions (some cameras settle late or rotate).
    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
      this.personCanvas.width = video.videoWidth;
      this.personCanvas.height = video.videoHeight;
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const wantsEffect = this.background !== "none";

    if (wantsEffect && this.segmenter && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      try {
        this.segmenter.segmentForVideo(video, performance.now(), (result) => {
          this.captureMask(result);
        });
      } catch {
        // Skip the mask this frame — the previous one still looks right.
      }
    }

    if (!wantsEffect || !this.hasMask) {
      // Passthrough (Clear, or the model is still loading).
      ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    // 1. Background layer.
    if (this.background === "blur") {
      ctx.save();
      // Blur radius scales with resolution; overdraw to hide edge vignetting.
      const radius = Math.max(8, Math.round(w / 60));
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(video, -radius * 2, -radius * 2, w + radius * 4, h + radius * 4);
      ctx.restore();
    } else {
      const painter = BACKGROUND_PAINTERS[this.background];
      if (painter) {
        painter(ctx, w, h);
      } else {
        ctx.drawImage(video, 0, 0, w, h);
        return;
      }
    }

    // 2. Person layer: frame masked by the (feathered, upscaled) confidence mask.
    const pctx = this.personCtx;
    pctx.clearRect(0, 0, w, h);
    pctx.drawImage(video, 0, 0, w, h);
    pctx.save();
    pctx.globalCompositeOperation = "destination-in";
    pctx.filter = `blur(${Math.max(2, Math.round(w / 320))}px)`;
    pctx.drawImage(this.maskCanvas, 0, 0, w, h);
    pctx.restore();
    ctx.drawImage(this.personCanvas, 0, 0, w, h);
  }

  /** Copies the segmenter's confidence mask into maskCanvas as alpha. */
  private captureMask(result: SegmenterResult): void {
    const mask = result.confidenceMasks?.[0];
    if (!mask) return;
    const { width, height } = mask;
    const values = mask.getAsFloat32Array();
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }
    if (
      !this.maskImage ||
      this.maskImage.width !== width ||
      this.maskImage.height !== height
    ) {
      this.maskImage = this.maskCtx.createImageData(width, height);
    }
    const pixels = this.maskImage.data;
    for (let i = 0; i < values.length; i++) {
      pixels[i * 4 + 3] = (values[i] ?? 0) * 255;
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0);
    this.hasMask = true;
  }
}
