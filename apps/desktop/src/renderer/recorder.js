/**
 * Ryloom recording engine (renderer, CommonJS).
 *
 * Captures the selected screen/window via Chromium's desktop capture
 * (chromeMediaSource constraints), optionally mixes the microphone through an
 * AudioContext into a MediaStreamAudioDestinationNode (ready for future
 * multi-source audio), and feeds the combined stream into a MediaRecorder
 * (hardware H.264 MP4 preferred, WebM VP9/VP8 fallback) with 1s timeslices
 * kept in memory.
 *
 * Effects: when a background is selected, the screen capture is composited
 * live onto a canvas — wallpaper behind, content inset with padding, rounded
 * corners and a drop shadow (the Loom "Canvas" look) — and the canvas stream
 * is what gets recorded. With no background selected the raw screen stream is
 * recorded directly (zero compositing cost).
 *
 * Crop (Loom-style "specific window" / "custom size"): the capture source is
 * always a whole SCREEN; opts.crop = { rect, displayBounds } (both in DIPs)
 * selects the sub-rectangle that ends up in the video, drawn through the same
 * canvas pipeline. Recording the screen instead of the window's own surface
 * is what keeps the floating camera bubble in the picture.
 *
 * The floating camera bubble is an always-on-top window, so it is composited
 * into the screen capture naturally — no canvas compositing needed for it.
 */
"use strict";

// H.264 first — it's hardware-encoded, while VP9/VP8 (libvpx) are software
// and silently drop frames at high resolutions.
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640033,mp4a.40.2",
  "video/webm;codecs=h264,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** Composite output is capped so encoding stays realtime on laptops. */
const MAX_COMPOSITE_WIDTH = 2560;
const MAX_COMPOSITE_HEIGHT = 1600;
const COMPOSITE_FPS = 30;

/** Padding presets (Effects → Canvas) as a fraction of the short edge. */
const PADDING_FRACTIONS = { none: 0, sm: 0.035, md: 0.06, lg: 0.095 };

/**
 * Background painters (Effects → Backgrounds). Each draws a full-canvas
 * backdrop. Ids must match the swatches in index.html's effects panel.
 */
const BACKGROUND_PAINTERS = {
  aurora(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#16102e");
    base.addColorStop(1, "#2c1f5e");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.22, h * 0.18, Math.max(w, h) * 0.5, "rgba(98, 93, 245, 0.5)");
    paintGlow(ctx, w * 0.85, h * 0.85, Math.max(w, h) * 0.45, "rgba(62, 207, 142, 0.32)");
  },
  sunset(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#ff7e5f");
    base.addColorStop(1, "#feb47b");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.8, h * 0.15, Math.max(w, h) * 0.5, "rgba(255, 94, 158, 0.45)");
  },
  ocean(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#0f2027");
    base.addColorStop(0.5, "#203a43");
    base.addColorStop(1, "#2c5364");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.75, h * 0.25, Math.max(w, h) * 0.45, "rgba(64, 196, 255, 0.3)");
  },
  candy(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#fc5c7d");
    base.addColorStop(1, "#6a82fb");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  forest(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#0b3d2e");
    base.addColorStop(1, "#1d976c");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.2, h * 0.8, Math.max(w, h) * 0.5, "rgba(56, 239, 125, 0.28)");
  },
  slate(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#1f1c2c");
    base.addColorStop(1, "#4e54c8");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  graphite(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#1b1924");
    base.addColorStop(1, "#2e2b3a");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  lavender(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#b993d6");
    base.addColorStop(1, "#8ca6db");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
};

function paintGlow(ctx, x, y, radius, color) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

class Recorder {
  constructor() {
    this._reset();
  }

  _reset() {
    this.screenStream = null;
    this.micStream = null;
    this.audioContext = null;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = null;
    this.startedAt = 0;
    this.pausedAccumMs = 0;
    this.pauseStartedAt = 0;
    this.state = "idle"; // idle | recording | paused | stopped
    this.onScreenEnded = null;
    this.onError = null;
    // Compositing pipeline (only when effects are active)
    this.compositeVideo = null;
    this.compositeCanvas = null;
    this.compositeTimer = null;
    this.compositeDims = null;
    this.compositeFrameHandle = null;
    this.compositeSuspended = false;
    this._compositeDrawNow = null;
    this._compositeSchedule = null;
  }

  static pickMimeType() {
    if (typeof MediaRecorder === "undefined") return "video/webm";
    return (
      MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ||
      "video/webm"
    );
  }

  static backgroundIds() {
    return Object.keys(BACKGROUND_PAINTERS);
  }

  /**
   * @param {{ sourceId: string, micEnabled: boolean, micDeviceId?: string|null,
   *           captureSize?: { width: number, height: number }|null,
   *           crop?: { rect: { x: number, y: number, width: number, height: number },
   *                    displayBounds: { x: number, y: number, width: number, height: number } }|null,
   *           effects?: { background?: string, padding?: string, corners?: string },
   *           onScreenEnded?: () => void, onError?: (err: Error) => void }} opts
   */
  async start(opts) {
    if (this.state !== "idle") {
      throw new Error("Recorder is already running");
    }
    this.onScreenEnded = opts.onScreenEnded || null;
    this.onError = opts.onError || null;

    // 1. Screen / window capture via the Electron desktop source id. Without
    // explicit size constraints Chromium caps desktop capture at 2880x1800
    // and downscales Retina/4K/5K displays (blurry, non-integer scaling), so
    // screens pin the display's physical pixel size (from get-sources) and
    // windows (size unknown up-front) just lift the cap.
    const mandatory = {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: opts.sourceId,
      maxFrameRate: 30,
    };
    const captureSize = opts.captureSize;
    if (captureSize && captureSize.width > 0 && captureSize.height > 0) {
      mandatory.minWidth = captureSize.width;
      mandatory.maxWidth = captureSize.width;
      mandatory.minHeight = captureSize.height;
      mandatory.maxHeight = captureSize.height;
    } else {
      mandatory.maxWidth = 4096;
      mandatory.maxHeight = 4096;
    }
    this.screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory },
    });

    const screenTrack = this.screenStream.getVideoTracks()[0];
    if (screenTrack) {
      screenTrack.addEventListener("ended", () => {
        // The OS/user killed the capture (e.g. the window closed) → auto-stop.
        if (this.state === "recording" || this.state === "paused") {
          if (this.onScreenEnded) this.onScreenEnded();
        }
      });
    }

    // 2. Video track: raw screen, or the composite canvas (needed for a
    // background wallpaper and/or a crop rect).
    const effects = opts.effects || {};
    const painter = BACKGROUND_PAINTERS[effects.background];
    const crop = Recorder._normalizeCrop(opts.crop);
    let videoTracks;
    if (painter || crop) {
      videoTracks = await this._startComposite(painter || null, effects, crop);
    } else {
      videoTracks = [...this.screenStream.getVideoTracks()];
    }
    const tracks = [...videoTracks];

    // 3. Microphone, mixed through an AudioContext destination node.
    if (opts.micEnabled) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: opts.micDeviceId
            ? {
                deviceId: { exact: opts.micDeviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        // Exact device may have been unplugged — fall back to the default mic.
        if (opts.micDeviceId) {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        } else {
          throw err;
        }
      }
      this.audioContext = new AudioContext();
      const destination = this.audioContext.createMediaStreamDestination();
      this.audioContext
        .createMediaStreamSource(this.micStream)
        .connect(destination);
      tracks.push(...destination.stream.getAudioTracks());
    }

    this.stream = new MediaStream(tracks);
    this.mimeType = Recorder.pickMimeType();
    this.chunks = [];

    // Bitrate scaled to the actual encoded area at 30fps; hardware H.264
    // affords a higher ceiling than software VP9/VP8.
    const trackSettings = (screenTrack && screenTrack.getSettings()) || {};
    const encodeDims = this.compositeDims || trackSettings;
    const encodeW = encodeDims.width || 1920;
    const encodeH = encodeDims.height || 1080;
    const isH264 = /mp4|h264|avc1/i.test(this.mimeType);
    const bpsPerPixelFrame = isH264 ? 0.12 : 0.1;
    const minBps = isH264 ? 8_000_000 : 6_000_000;
    const maxBps = isH264 ? 32_000_000 : 24_000_000;
    const videoBitsPerSecond = Math.min(
      maxBps,
      Math.max(minBps, Math.round(encodeW * encodeH * 30 * bpsPerPixelFrame)),
    );

    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: 128_000,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onerror = (event) => {
      const err = (event && event.error) || new Error("MediaRecorder error");
      if (this.onError) this.onError(err);
    };

    this.recorder.start(1000); // 1s timeslices kept in memory
    this.startedAt = Date.now();
    this.pausedAccumMs = 0;
    this.pauseStartedAt = 0;
    this.state = "recording";
  }

  /** Validates a crop option; returns null unless both rects are usable. */
  static _normalizeCrop(crop) {
    if (!crop || !crop.rect || !crop.displayBounds) return null;
    const nums = [
      crop.rect.x,
      crop.rect.y,
      crop.rect.width,
      crop.rect.height,
      crop.displayBounds.x,
      crop.displayBounds.y,
      crop.displayBounds.width,
      crop.displayBounds.height,
    ];
    if (!nums.every(Number.isFinite)) return null;
    if (
      crop.rect.width < 2 ||
      crop.rect.height < 2 ||
      crop.displayBounds.width < 2 ||
      crop.displayBounds.height < 2
    ) {
      return null;
    }
    return crop;
  }

  /**
   * Spins up the canvas pipeline: hidden <video> playing the screen stream,
   * drawn ~30fps onto a canvas — optionally cropped to a sub-rectangle of the
   * display, optionally on a wallpaper with inset + rounded corners.
   * Resolves with the canvas stream's video tracks.
   */
  async _startComposite(painter, effects, crop) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(this.screenStream.getVideoTracks());
    // Off-screen but attached — Chromium keeps decoding frames this way.
    video.style.cssText =
      "position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
    this.compositeVideo = video;

    await video.play();
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((resolve) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        setTimeout(resolve, 1500); // belt and braces — don't hang forever
      });
    }
    // Track settings are synchronous and reflect the negotiated capture size,
    // so they can't lose the loadedmetadata race (which would silently
    // stretch the whole recording from a 1920x1080 fallback).
    const trackSettings =
      (this.screenStream.getVideoTracks()[0] || { getSettings: () => ({}) }).getSettings();
    const srcW = trackSettings.width || video.videoWidth || 1920;
    const srcH = trackSettings.height || video.videoHeight || 1080;

    // Source rectangle inside the captured frame, in the frame's physical
    // pixels. Crop rects arrive in DIPs — scaling by the actual track size
    // (rather than trusting scaleFactor) absorbs HiDPI and any capture-side
    // downscaling in one step.
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (crop) {
      const scaleX = srcW / crop.displayBounds.width;
      const scaleY = srcH / crop.displayBounds.height;
      sx = Math.max(0, Math.min(srcW - 2, (crop.rect.x - crop.displayBounds.x) * scaleX));
      sy = Math.max(0, Math.min(srcH - 2, (crop.rect.y - crop.displayBounds.y) * scaleY));
      sw = Math.max(2, Math.min(srcW - sx, crop.rect.width * scaleX));
      sh = Math.max(2, Math.min(srcH - sy, crop.rect.height * scaleY));
    }

    // Cap the composite size so encoding stays realtime.
    const scale = Math.min(
      1,
      MAX_COMPOSITE_WIDTH / sw,
      MAX_COMPOSITE_HEIGHT / sh,
    );
    const cw = Math.max(2, 2 * Math.round((sw * scale) / 2));
    const ch = Math.max(2, 2 * Math.round((sh * scale) / 2));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high"; // default 'low' bilinear shimmers on downscale
    this.compositeCanvas = canvas;
    this.compositeDims = { width: cw, height: ch };

    // Wallpaper inset/corners only make sense with a wallpaper behind them —
    // a bare crop fills the canvas edge to edge.
    const padFraction = painter
      ? PADDING_FRACTIONS[effects.padding] ?? PADDING_FRACTIONS.md
      : 0;
    const pad = Math.round(Math.min(cw, ch) * padFraction);
    const rounded = painter ? effects.corners !== "square" : false;
    const innerW = cw - pad * 2;
    const innerH = ch - pad * 2;
    const radius = rounded ? Math.max(8, Math.round(Math.min(cw, ch) * 0.02)) : 0;

    const draw = () => {
      if (painter) {
        painter(ctx, cw, ch);
        if (pad > 0) {
          // Drop shadow under the inset content.
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
          ctx.shadowBlur = Math.max(16, pad * 0.8);
          ctx.shadowOffsetY = Math.max(4, pad * 0.18);
          roundRectPath(ctx, pad, pad, innerW, innerH, radius);
          ctx.fillStyle = "#000";
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.save();
      if (radius > 0) {
        roundRectPath(ctx, pad, pad, innerW, innerH, radius);
        ctx.clip();
      }
      ctx.drawImage(video, sx, sy, sw, sh, pad, pad, innerW, innerH);
      ctx.restore();
    };

    // Frame-synced clock: draw only when the <video> actually receives a new
    // capture frame (no duplicate frames burning encoder bitrate), with a
    // slow watchdog repaint in case the source stalls. backgroundThrottling
    // is false on the window, so rVFC keeps firing while hidden.
    let lastDrawAt = 0;
    const drawNow = () => {
      draw();
      lastDrawAt = performance.now();
    };
    const scheduleFrame = () => {
      if (this.compositeSuspended || this.compositeVideo !== video) return;
      if (this.compositeFrameHandle !== null) return;
      this.compositeFrameHandle = video.requestVideoFrameCallback(() => {
        this.compositeFrameHandle = null;
        if (this.compositeSuspended || this.compositeVideo !== video) return;
        drawNow();
        scheduleFrame();
      });
    };
    this._compositeDrawNow = drawNow;
    this._compositeSchedule = scheduleFrame;
    this.compositeSuspended = false;

    drawNow();
    if (typeof video.requestVideoFrameCallback === "function") {
      scheduleFrame();
      this.compositeTimer = setInterval(() => {
        if (this.compositeSuspended) return;
        if (performance.now() - lastDrawAt > 80) drawNow();
        scheduleFrame(); // no-op if a callback is already pending
      }, 250);
    } else {
      // rVFC unavailable — fall back to the old fixed-rate clock.
      this.compositeTimer = setInterval(() => {
        if (!this.compositeSuspended) drawNow();
      }, Math.round(1000 / COMPOSITE_FPS));
    }

    const canvasStream = canvas.captureStream(COMPOSITE_FPS);
    return canvasStream.getVideoTracks();
  }

  _suspendComposite() {
    this.compositeSuspended = true;
    if (
      this.compositeVideo &&
      this.compositeFrameHandle !== null &&
      typeof this.compositeVideo.cancelVideoFrameCallback === "function"
    ) {
      this.compositeVideo.cancelVideoFrameCallback(this.compositeFrameHandle);
    }
    this.compositeFrameHandle = null;
  }

  _resumeComposite() {
    if (!this.compositeVideo) return;
    this.compositeSuspended = false;
    if (this._compositeDrawNow) this._compositeDrawNow();
    if (this._compositeSchedule) this._compositeSchedule();
  }

  pause() {
    if (this.state !== "recording" || !this.recorder) return;
    try {
      this.recorder.pause();
    } catch {
      return;
    }
    this._suspendComposite();
    this.pauseStartedAt = Date.now();
    this.state = "paused";
  }

  resume() {
    if (this.state !== "paused" || !this.recorder) return;
    try {
      this.recorder.resume();
    } catch {
      return;
    }
    this._resumeComposite();
    this.pausedAccumMs += Date.now() - this.pauseStartedAt;
    this.pauseStartedAt = 0;
    this.state = "recording";
  }

  /** Recorded wall-clock time excluding pauses, in milliseconds. */
  get elapsedMs() {
    if (!this.startedAt) return 0;
    const pausedNow =
      this.state === "paused" && this.pauseStartedAt
        ? Date.now() - this.pauseStartedAt
        : 0;
    return Math.max(0, Date.now() - this.startedAt - this.pausedAccumMs - pausedNow);
  }

  /** Actual recorded dimensions (composite size when effects are active). */
  get dimensions() {
    if (this.compositeDims) return this.compositeDims;
    const track = this.screenStream && this.screenStream.getVideoTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    if (!settings.width || !settings.height) return null;
    return { width: settings.width, height: settings.height };
  }

  /** Stops recording and resolves with the final WebM Blob. */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.state === "idle" || this.state === "stopped") {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/webm" });
        this._teardown();
        resolve(blob);
        return;
      }
      this.state = "stopped";
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/webm" });
        this._teardown();
        resolve(blob);
      };
      try {
        this.recorder.stop();
      } catch {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/webm" });
        this._teardown();
        resolve(blob);
      }
    });
  }

  /** Aborts the recording and discards all captured data. */
  cancel() {
    if (this.recorder && this.state !== "idle" && this.state !== "stopped") {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    this._teardown();
    this.chunks = [];
    this.state = "idle";
  }

  _teardown() {
    if (this.compositeTimer) {
      clearInterval(this.compositeTimer);
      this.compositeTimer = null;
    }
    this._suspendComposite(); // cancels any pending video-frame callback
    this._compositeDrawNow = null;
    this._compositeSchedule = null;
    if (this.compositeVideo) {
      try {
        this.compositeVideo.pause();
        this.compositeVideo.srcObject = null;
        this.compositeVideo.remove();
      } catch {
        /* ignore */
      }
      this.compositeVideo = null;
    }
    this.compositeCanvas = null;
    this.compositeDims = null;
    for (const stream of [this.screenStream, this.micStream, this.stream]) {
      if (stream) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
    this.screenStream = null;
    this.micStream = null;
    this.audioContext = null;
    this.stream = null;
    this.recorder = null;
  }
}

module.exports = { Recorder };
