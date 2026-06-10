/**
 * Ryloom recording engine (renderer, CommonJS).
 *
 * Captures the selected screen/window via Chromium's desktop capture
 * (chromeMediaSource constraints), optionally mixes the microphone through an
 * AudioContext into a MediaStreamAudioDestinationNode (ready for future
 * multi-source audio), and feeds the combined stream into a MediaRecorder
 * producing WebM (VP9+Opus, VP8 fallback) with 1s timeslices kept in memory.
 *
 * The floating camera bubble is an always-on-top window, so it is composited
 * into the screen capture naturally — no canvas compositing needed.
 */
"use strict";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

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
  }

  static pickMimeType() {
    if (typeof MediaRecorder === "undefined") return "video/webm";
    return (
      MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ||
      "video/webm"
    );
  }

  /**
   * @param {{ sourceId: string, micEnabled: boolean, micDeviceId?: string|null,
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

    const tracks = [...this.screenStream.getVideoTracks()];
    const screenTrack = tracks[0];
    if (screenTrack) {
      screenTrack.addEventListener("ended", () => {
        // The OS/user killed the capture (e.g. the window closed) → auto-stop.
        if (this.state === "recording" || this.state === "paused") {
          if (this.onScreenEnded) this.onScreenEnded();
        }
      });
    }

    // 2. Microphone, mixed through an AudioContext destination node.
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

  /** Actual capture dimensions, from the screen video track settings. */
  get dimensions() {
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
    for (const stream of [this.screenStream, this.micStream]) {
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
