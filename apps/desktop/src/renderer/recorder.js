/**
 * Ryloom recording engine (renderer, CommonJS).
 *
 * Captures the selected screen/window via Chromium's desktop capture
 * (chromeMediaSource constraints), optionally mixes the microphone through an
 * AudioContext into a MediaStreamAudioDestinationNode (ready for future
 * multi-source audio), and feeds the combined stream into a MediaRecorder
 * producing WebM (VP9+Opus, VP8 fallback) with 1s timeslices kept in memory.
 *
 * Effects: when a background is selected, the screen capture is composited
 * live onto a canvas — wallpaper behind, content inset with padding, rounded
 * corners and a drop shadow (the Loom "Canvas" look) — and the canvas stream
 * is what gets recorded. With no background selected the raw screen stream is
 * recorded directly (zero compositing cost).
 *
 * The floating camera bubble is an always-on-top window, so it is composited
 * into the screen capture naturally — no canvas compositing needed for it.
 */
"use strict";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** Composite output is capped so encoding stays realtime on laptops. */
const MAX_COMPOSITE_WIDTH = 1920;
const MAX_COMPOSITE_HEIGHT = 1200;
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
   *           effects?: { background?: string, padding?: string, corners?: string },
   *           onScreenEnded?: () => void, onError?: (err: Error) => void }} opts
   */
  async start(opts) {
    if (this.state !== "idle") {
      throw new Error("Recorder is already running");
    }
    this.onScreenEnded = opts.onScreenEnded || null;
    this.onError = opts.onError || null;

    // 1. Screen / window capture via the Electron desktop source id.
    this.screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: opts.sourceId,
          maxFrameRate: 30,
        },
      },
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

    // 2. Video track: raw screen, or the effects composite canvas.
    const effects = opts.effects || {};
    const painter = BACKGROUND_PAINTERS[effects.background];
    let videoTracks;
    if (painter) {
      videoTracks = await this._startComposite(painter, effects);
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

    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 8_000_000,
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

  /**
   * Spins up the canvas pipeline: hidden <video> playing the screen stream,
   * drawn ~30fps onto a canvas with background + inset + rounded corners.
   * Resolves with the canvas stream's video tracks.
   */
  async _startComposite(painter, effects) {
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
    const srcW = video.videoWidth || 1920;
    const srcH = video.videoHeight || 1080;

    // Cap the composite size so VP9 encoding stays realtime.
    const scale = Math.min(
      1,
      MAX_COMPOSITE_WIDTH / srcW,
      MAX_COMPOSITE_HEIGHT / srcH,
    );
    const cw = Math.max(2, 2 * Math.round((srcW * scale) / 2));
    const ch = Math.max(2, 2 * Math.round((srcH * scale) / 2));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { alpha: false });
    this.compositeCanvas = canvas;
    this.compositeDims = { width: cw, height: ch };

    const padFraction =
      PADDING_FRACTIONS[effects.padding] ?? PADDING_FRACTIONS.md;
    const pad = Math.round(Math.min(cw, ch) * padFraction);
    const rounded = effects.corners !== "square";
    const innerW = cw - pad * 2;
    const innerH = ch - pad * 2;
    const radius = rounded ? Math.max(8, Math.round(Math.min(cw, ch) * 0.02)) : 0;

    const draw = () => {
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
      ctx.save();
      roundRectPath(ctx, pad, pad, innerW, innerH, radius);
      ctx.clip();
      ctx.drawImage(video, pad, pad, innerW, innerH);
      ctx.restore();
    };

    draw();
    this.compositeTimer = setInterval(draw, Math.round(1000 / COMPOSITE_FPS));

    const canvasStream = canvas.captureStream(COMPOSITE_FPS);
    return canvasStream.getVideoTracks();
  }

  pause() {
    if (this.state !== "recording" || !this.recorder) return;
    try {
      this.recorder.pause();
    } catch {
      return;
    }
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
