"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Captions,
  Check,
  ExternalLink,
  ListVideo,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type HlsType from "hls.js";

import type { EditRange, VideoChapter, VideoCta } from "@ryloom/db";
import {
  normalizeKeepRanges,
  rawToVirtualMs,
  snapToKeepMs,
  virtualDurationMs,
  virtualToRawMs,
} from "@/lib/edit-ranges";
import { cn, formatDuration } from "@/lib/utils";

export type PlayerEventType =
  | "play"
  | "pause"
  | "seek"
  | "complete"
  | "progress_25"
  | "progress_50"
  | "progress_75"
  | "cta_clicked";

export type VideoPlayerHandle = {
  seekTo: (ms: number) => void;
  getCurrentTimeMs: () => number;
  play: () => void;
  pause: () => void;
};

export type VideoPlayerProps = {
  mp4Url: string | null;
  hlsUrl: string | null;
  captionsUrl: string | null;
  poster?: string | null;
  chapters?: VideoChapter[] | null;
  durationMs?: number | null;
  watermarkEmail?: string | null;
  cta?: VideoCta | null;
  brandColor?: string | null;
  /**
   * Pending (non-destructive) edit: KEEP ranges in ms on the raw playback
   * file's timeline. When set, the player presents the virtual timeline —
   * cut sections are skipped during playback and hidden from the seek bar
   * and duration — until the worker swaps in the flattened file.
   */
  keepRanges?: EditRange[] | null;
  onEvent?: (type: PlayerEventType, playheadMs: number) => void;
  /** Fired on every native timeupdate (~4Hz) with the playhead in ms. */
  onTimeUpdate?: (playheadMs: number) => void;
  autoPlay?: boolean;
  className?: string;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const WATERMARK_POSITIONS = [
  "left-4 top-4",
  "right-4 top-4",
  "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "bottom-16 left-4",
  "bottom-16 right-4",
];

type BufferedRange = { start: number; end: number };

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      mp4Url,
      hlsUrl,
      captionsUrl,
      poster,
      chapters,
      durationMs,
      watermarkEmail,
      cta,
      brandColor,
      keepRanges,
      onEvent,
      onTimeUpdate,
      autoPlay,
      className,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const seekBarRef = useRef<HTMLDivElement>(null);
    const volumeBarRef = useRef<HTMLDivElement>(null);
    const hoveredRef = useRef(false);
    const activityTimerRef = useRef<number | null>(null);
    const progressFiredRef = useRef({ p25: false, p50: false, p75: false });

    const onEventRef = useRef(onEvent);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onEventRef.current = onEvent;
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onEvent, onTimeUpdate]);

    // Pending-edit virtual timeline. Empty array = no pending edit; the
    // player then behaves exactly as before (raw timeline).
    const keeps = useMemo(
      () =>
        keepRanges && keepRanges.length > 0 ? normalizeKeepRanges(keepRanges) : [],
      [keepRanges],
    );
    const keepsRef = useRef(keeps);
    const virtualEndedRef = useRef(false);
    // Programmatic currentTime assignments (cut-skips, snaps, replay rewinds)
    // fire a native `seeked`; this flags the next one so it isn't reported
    // as a viewer-initiated seek.
    const suppressNextSeekRef = useRef(false);
    useEffect(() => {
      keepsRef.current = keeps;
      if (keeps.length === 0) virtualEndedRef.current = false;
    }, [keeps]);

    const [playing, setPlaying] = useState(false);
    const [started, setStarted] = useState(false);
    const [ended, setEnded] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [mediaDurationMs, setMediaDurationMs] = useState(0);
    const [buffered, setBuffered] = useState<BufferedRange[]>([]);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [controlsActive, setControlsActive] = useState(true);
    const [menu, setMenu] = useState<"speed" | "chapters" | null>(null);
    const [hoverFraction, setHoverFraction] = useState<number | null>(null);
    const [dragFraction, setDragFraction] = useState<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [pipSupported, setPipSupported] = useState(false);
    const [watermarkIdx, setWatermarkIdx] = useState(0);

    const rawTotalMs = mediaDurationMs > 0 ? mediaDurationMs : (durationMs ?? 0);
    const totalMs = keeps.length > 0 ? virtualDurationMs(keeps) : rawTotalMs;

    // Chapters and the CTA are authored in raw-timeline ms; while a pending
    // edit is active, remap them onto the virtual timeline so menu seeks,
    // tick marks, and reveal times line up with what the viewer sees.
    const displayChapters = useMemo(() => {
      if (!chapters || chapters.length === 0 || keeps.length === 0) return chapters;
      const virtualTotal = virtualDurationMs(keeps);
      return chapters
        .map((c) => ({ ...c, startMs: rawToVirtualMs(c.startMs, keeps) }))
        .filter((c) => c.startMs < virtualTotal);
    }, [chapters, keeps]);
    const displayCta = useMemo(() => {
      if (!cta || keeps.length === 0) return cta;
      return cta.showAtMs !== null && cta.showAtMs !== undefined
        ? { ...cta, showAtMs: rawToVirtualMs(cta.showAtMs, keeps) }
        : cta;
    }, [cta, keeps]);

    // ----- Source attachment (MP4 / HLS / native HLS) -----------------------

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      let hls: HlsType | null = null;
      let cancelled = false;

      // The progressive MP4 is the cleanest encode we produce (a single
      // x264 generation); the HLS renditions are re-encodes of it. Prefer
      // the MP4 so viewers see download-grade quality, and keep HLS as the
      // fallback when the MP4 is missing or fails to load.
      const attachHls = () => {
        if (!hlsUrl) return;
        const canPlayNativeHls =
          video.canPlayType("application/vnd.apple.mpegurl") !== "";
        if (canPlayNativeHls) {
          video.src = hlsUrl;
          return;
        }
        void import("hls.js").then(({ default: Hls }) => {
          if (cancelled || !Hls.isSupported()) return;
          hls = new Hls({
            maxBufferLength: 30,
            // Default ~500kbps estimate starts every video at the 360p rung;
            // screen recordings are low-bitrate, so start optimistic and let
            // measured throughput correct downward.
            abrEwmaDefaultEstimate: 6_000_000,
          });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
        });
      };

      const onSourceError = () => {
        if (video.src && mp4Url && video.src.includes(mp4Url) && hlsUrl) {
          attachHls();
        }
      };

      if (mp4Url) {
        video.src = mp4Url;
        video.addEventListener("error", onSourceError);
      } else {
        attachHls();
      }

      return () => {
        cancelled = true;
        video.removeEventListener("error", onSourceError);
        hls?.destroy();
      };
    }, [hlsUrl, mp4Url]);

    // ----- Media event wiring ------------------------------------------------

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      // Events and displayed positions report virtual ms while a pending
      // edit is active, raw ms otherwise.
      const toDisplayMs = (rawMs: number) => {
        const k = keepsRef.current;
        return k.length > 0 ? rawToVirtualMs(rawMs, k) : rawMs;
      };
      const emit = (type: PlayerEventType) =>
        onEventRef.current?.(type, Math.round(toDisplayMs(video.currentTime * 1000)));

      // Move the playhead out of a cut section (to the next kept one) so no
      // trimmed-off frames render.
      const snapIntoKeeps = () => {
        const k = keepsRef.current;
        if (k.length === 0) return;
        const rawMs = video.currentTime * 1000;
        const snapped = snapToKeepMs(rawMs, k);
        if (snapped !== null && snapped > rawMs + 10) {
          suppressNextSeekRef.current = true;
          video.currentTime = snapped / 1000;
        }
      };

      const onPlay = () => {
        virtualEndedRef.current = false;
        // Covers autoplay and imperative play(): snap before a trimmed-off
        // intro gets a chance to render.
        snapIntoKeeps();
        setPlaying(true);
        setEnded(false);
        setStarted(true);
        emit("play");
      };
      const onPause = () => {
        setPlaying(false);
        if (!video.ended && !virtualEndedRef.current) emit("pause");
      };
      const onTime = () => {
        const rawMs = video.currentTime * 1000;
        const k = keepsRef.current;
        let ms = rawMs;
        let pct =
          isFinite(video.duration) && video.duration > 0
            ? video.currentTime / video.duration
            : null;
        if (k.length > 0) {
          const virtualTotal = virtualDurationMs(k);
          const snapped = snapToKeepMs(rawMs, k);
          if (snapped === null) {
            // Past the last keep range: this is the virtual end of the video.
            if (!virtualEndedRef.current) {
              virtualEndedRef.current = true;
              video.pause();
              setPlaying(false);
              setEnded(true);
              emit("complete");
            }
            setCurrentMs(virtualTotal);
            onTimeUpdateRef.current?.(virtualTotal);
            return;
          }
          virtualEndedRef.current = false;
          if (snapped > rawMs + 10) {
            // Inside a cut section — jump over it to the next kept one.
            suppressNextSeekRef.current = true;
            video.currentTime = snapped / 1000;
            return;
          }
          ms = rawToVirtualMs(rawMs, k);
          pct = virtualTotal > 0 ? ms / virtualTotal : null;
        }
        setCurrentMs(ms);
        onTimeUpdateRef.current?.(ms);
        if (pct !== null) {
          const fired = progressFiredRef.current;
          if (pct >= 0.25 && !fired.p25) {
            fired.p25 = true;
            emit("progress_25");
          }
          if (pct >= 0.5 && !fired.p50) {
            fired.p50 = true;
            emit("progress_50");
          }
          if (pct >= 0.75 && !fired.p75) {
            fired.p75 = true;
            emit("progress_75");
          }
        }
      };
      const onSeeked = () => {
        if (suppressNextSeekRef.current) {
          suppressNextSeekRef.current = false;
          return;
        }
        emit("seek");
      };
      const onEnded = () => {
        setPlaying(false);
        setEnded(true);
        // When the last keep range runs to the raw end of the file, both the
        // virtual-end branch in onTime and this handler fire — keep the
        // `complete` emits mutually exclusive (in either order).
        if (virtualEndedRef.current) return;
        virtualEndedRef.current = true;
        emit("complete");
      };
      const onMeta = () => {
        if (isFinite(video.duration) && video.duration > 0) {
          setMediaDurationMs(video.duration * 1000);
        }
      };
      const onLoadedMeta = () => {
        onMeta();
        // The poster / first decoded frame should come from the first keep
        // range, not a trimmed-off intro.
        snapIntoKeeps();
      };
      const onProgress = () => {
        if (!isFinite(video.duration) || video.duration <= 0) return;
        const k = keepsRef.current;
        const totalVirtualMs =
          k.length > 0 ? virtualDurationMs(k) : video.duration * 1000;
        if (totalVirtualMs <= 0) {
          setBuffered([]);
          return;
        }
        const ranges: BufferedRange[] = [];
        for (let i = 0; i < video.buffered.length; i++) {
          const startMs = video.buffered.start(i) * 1000;
          const endMs = video.buffered.end(i) * 1000;
          ranges.push(
            k.length > 0
              ? {
                  start: rawToVirtualMs(startMs, k) / totalVirtualMs,
                  end: rawToVirtualMs(endMs, k) / totalVirtualMs,
                }
              : { start: startMs / totalVirtualMs, end: endMs / totalVirtualMs },
          );
        }
        setBuffered(ranges);
      };
      const onVolumeChange = () => {
        setVolume(video.volume);
        setMuted(video.muted);
      };
      const onRateChange = () => setRate(video.playbackRate);
      const onWaiting = () => setBuffering(true);
      const onPlaying = () => setBuffering(false);
      const onCanPlay = () => setBuffering(false);

      video.addEventListener("play", onPlay);
      video.addEventListener("pause", onPause);
      video.addEventListener("timeupdate", onTime);
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("ended", onEnded);
      video.addEventListener("loadedmetadata", onLoadedMeta);
      video.addEventListener("durationchange", onMeta);
      video.addEventListener("progress", onProgress);
      video.addEventListener("volumechange", onVolumeChange);
      video.addEventListener("ratechange", onRateChange);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("playing", onPlaying);
      video.addEventListener("canplay", onCanPlay);
      return () => {
        video.removeEventListener("play", onPlay);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("timeupdate", onTime);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("loadedmetadata", onLoadedMeta);
        video.removeEventListener("durationchange", onMeta);
        video.removeEventListener("progress", onProgress);
        video.removeEventListener("volumechange", onVolumeChange);
        video.removeEventListener("ratechange", onRateChange);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("canplay", onCanPlay);
      };
    }, []);

    // ----- Captions ----------------------------------------------------------

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      const apply = () => {
        const tracks = video.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          if (track) track.mode = captionsOn && i === 0 ? "showing" : "hidden";
        }
      };
      apply();
      video.textTracks.addEventListener("addtrack", apply);
      return () => video.textTracks.removeEventListener("addtrack", apply);
    }, [captionsOn, captionsUrl]);

    // ----- Fullscreen / PiP availability -------------------------------------

    useEffect(() => {
      const sync = () => setIsFullscreen(document.fullscreenElement !== null);
      document.addEventListener("fullscreenchange", sync);
      setPipSupported(
        "pictureInPictureEnabled" in document && document.pictureInPictureEnabled,
      );
      return () => document.removeEventListener("fullscreenchange", sync);
    }, []);

    // ----- Watermark position cycling ----------------------------------------

    useEffect(() => {
      if (!watermarkEmail) return;
      const id = window.setInterval(
        () => setWatermarkIdx((i) => (i + 1) % WATERMARK_POSITIONS.length),
        20_000,
      );
      return () => window.clearInterval(id);
    }, [watermarkEmail]);

    // ----- Control helpers ----------------------------------------------------

    const showActivity = useCallback(() => {
      setControlsActive(true);
      if (activityTimerRef.current) window.clearTimeout(activityTimerRef.current);
      activityTimerRef.current = window.setTimeout(
        () => setControlsActive(false),
        2600,
      );
    }, []);

    useEffect(() => {
      return () => {
        if (activityTimerRef.current) window.clearTimeout(activityTimerRef.current);
      };
    }, []);

    const togglePlay = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused || v.ended) {
        const k = keepsRef.current;
        if (k.length > 0 && snapToKeepMs(v.currentTime * 1000, k) === null) {
          // Replay after the virtual end: rewind to the first kept section.
          v.currentTime = (k[0]?.startMs ?? 0) / 1000;
        }
        void v.play();
      } else {
        v.pause();
      }
    }, []);

    /** Seeks to a position given in *virtual* ms when a pending edit is
     * active, raw ms otherwise. */
    const seekToMs = useCallback((ms: number) => {
      const v = videoRef.current;
      if (!v) return;
      const k = keepsRef.current;
      const rawMs = k.length > 0 ? virtualToRawMs(Math.max(0, ms), k) : ms;
      virtualEndedRef.current = false;
      const durS = isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      const targetS = Math.max(0, rawMs / 1000);
      v.currentTime = durS !== null ? Math.min(targetS, Math.max(0, durS - 0.05)) : targetS;
    }, []);

    const setVolumeClamped = useCallback((value: number) => {
      const v = videoRef.current;
      if (!v) return;
      const clamped = Math.min(1, Math.max(0, value));
      v.volume = clamped;
      if (clamped > 0) v.muted = false;
    }, []);

    const toggleMute = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      v.muted = !v.muted;
    }, []);

    const toggleFullscreen = useCallback(() => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void containerRef.current?.requestFullscreen?.();
      }
    }, []);

    const togglePip = useCallback(async () => {
      const v = videoRef.current;
      if (!v) return;
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
          await v.requestPictureInPicture();
        }
      } catch {
        // PiP can be rejected by the browser; ignore.
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (ms: number) => seekToMs(ms),
        getCurrentTimeMs: () => {
          const rawMs = (videoRef.current?.currentTime ?? 0) * 1000;
          const k = keepsRef.current;
          return k.length > 0 ? rawToVirtualMs(rawMs, k) : rawMs;
        },
        play: () => void videoRef.current?.play(),
        pause: () => videoRef.current?.pause(),
      }),
      [seekToMs],
    );

    // ----- Keyboard shortcuts (active while hovered or focused) ---------------

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const container = containerRef.current;
        const v = videoRef.current;
        if (!container || !v) return;
        const active = document.activeElement;
        const engaged =
          hoveredRef.current || (active !== null && container.contains(active));
        if (!engaged) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) {
          return;
        }
        // Relative seeks operate on the virtual timeline while a pending
        // edit is active (seekToMs converts back to raw).
        const curMs = () => {
          const k = keepsRef.current;
          const rawMs = v.currentTime * 1000;
          return k.length > 0 ? rawToVirtualMs(rawMs, k) : rawMs;
        };
        let handled = true;
        switch (e.key) {
          case " ":
          case "k":
          case "K":
            togglePlay();
            break;
          case "j":
          case "J":
            seekToMs(curMs() - 10_000);
            break;
          case "l":
          case "L":
            seekToMs(curMs() + 10_000);
            break;
          case "ArrowLeft":
            seekToMs(curMs() - 5_000);
            break;
          case "ArrowRight":
            seekToMs(curMs() + 5_000);
            break;
          case "ArrowUp":
            setVolumeClamped(v.volume + 0.1);
            break;
          case "ArrowDown":
            setVolumeClamped(v.volume - 0.1);
            break;
          case "m":
          case "M":
            toggleMute();
            break;
          case "f":
          case "F":
            toggleFullscreen();
            break;
          case "c":
          case "C":
            setCaptionsOn((prev) => !prev);
            break;
          default:
            if (/^[0-9]$/.test(e.key)) {
              const k = keepsRef.current;
              if (k.length > 0) {
                seekToMs((Number(e.key) / 10) * virtualDurationMs(k));
              } else if (isFinite(v.duration) && v.duration > 0) {
                v.currentTime = (Number(e.key) / 10) * v.duration;
              }
            } else {
              handled = false;
            }
        }
        if (handled) {
          e.preventDefault();
          showActivity();
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [togglePlay, seekToMs, setVolumeClamped, toggleMute, toggleFullscreen, showActivity]);

    // ----- Menu dismiss on outside press ---------------------------------------

    useEffect(() => {
      if (!menu) return;
      const close = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-player-menu]")) return;
        setMenu(null);
      };
      document.addEventListener("pointerdown", close);
      return () => document.removeEventListener("pointerdown", close);
    }, [menu]);

    // ----- Seek bar interaction ------------------------------------------------

    const fractionFromClientX = useCallback((clientX: number) => {
      const el = seekBarRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    }, []);

    const commitSeekFraction = useCallback(
      (fraction: number) => {
        const v = videoRef.current;
        const k = keepsRef.current;
        if (k.length > 0) {
          // The seek bar fraction is over the virtual timeline.
          seekToMs(fraction * virtualDurationMs(k));
        } else if (v && isFinite(v.duration) && v.duration > 0) {
          v.currentTime = fraction * v.duration;
        } else if (totalMs > 0) {
          seekToMs(fraction * totalMs);
        }
      },
      [seekToMs, totalMs],
    );

    const handleSeekDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      seekBarRef.current?.setPointerCapture(e.pointerId);
      setDragFraction(fractionFromClientX(e.clientX));
    };
    const handleSeekMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const fraction = fractionFromClientX(e.clientX);
      setHoverFraction(fraction);
      if (dragFraction !== null) setDragFraction(fraction);
    };
    const handleSeekUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragFraction !== null) {
        commitSeekFraction(dragFraction);
        setDragFraction(null);
      }
      if (seekBarRef.current?.hasPointerCapture(e.pointerId)) {
        seekBarRef.current.releasePointerCapture(e.pointerId);
      }
    };

    // ----- Volume bar interaction -----------------------------------------------

    const volumeFromClientX = useCallback(
      (clientX: number) => {
        const el = volumeBarRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        setVolumeClamped((clientX - rect.left) / rect.width);
      },
      [setVolumeClamped],
    );

    const handleVolumeDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      volumeBarRef.current?.setPointerCapture(e.pointerId);
      volumeFromClientX(e.clientX);
    };
    const handleVolumeMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons === 1) volumeFromClientX(e.clientX);
    };

    // ----- Derived view state -----------------------------------------------------

    const controlsShown =
      controlsActive || !playing || ended || menu !== null || dragFraction !== null;
    const playedFraction =
      dragFraction ?? (totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0);
    const displayMs = dragFraction !== null ? dragFraction * totalMs : currentMs;
    const hoverMs = hoverFraction !== null ? hoverFraction * totalMs : null;
    const hoverChapter =
      hoverMs !== null && chapters?.length
        ? [...chapters]
            .sort((a, b) => a.startMs - b.startMs)
            .filter((c) => c.startMs <= hoverMs)
            .at(-1)
        : undefined;
    const currentChapter =
      chapters?.length
        ? [...chapters]
            .sort((a, b) => a.startMs - b.startMs)
            .filter((c) => c.startMs <= currentMs)
            .at(-1)
        : undefined;
    const ctaVisible =
      !!cta &&
      (cta.showAtMs !== null && cta.showAtMs !== undefined
        ? currentMs >= cta.showAtMs
        : ended || (started && !playing));
    const accentStyle = brandColor ? { backgroundColor: brandColor } : undefined;
    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    const handleCta = () => {
      if (!cta) return;
      onEventRef.current?.(
        "cta_clicked",
        Math.round((videoRef.current?.currentTime ?? 0) * 1000),
      );
      window.open(cta.url, "_blank", "noopener,noreferrer");
    };

    const controlBtn =
      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        role="region"
        aria-label="Video player"
        onMouseEnter={() => {
          hoveredRef.current = true;
          showActivity();
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          setHoverFraction(null);
        }}
        onPointerMove={showActivity}
        className={cn(
          "relative isolate aspect-video w-full select-none overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring",
          playing && !controlsShown && "cursor-none",
          className,
        )}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- caption track rendered conditionally below */}
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          poster={poster ?? undefined}
          preload="metadata"
          playsInline
          autoPlay={autoPlay}
          crossOrigin="anonymous"
        >
          {captionsUrl ? (
            <track kind="captions" src={captionsUrl} srcLang="en" label="English" />
          ) : null}
        </video>

        {/* Click layer: play/pause + double-click fullscreen */}
        <div
          className="absolute inset-0 z-10"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
        />

        {/* Buffering spinner */}
        {buffering && started && !ended && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-white/80" />
          </div>
        )}

        {/* Center play / replay overlay */}
        {!playing && !buffering && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={ended ? "Replay" : "Play"}
            className="absolute inset-0 z-20 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white shadow-xl transition-transform duration-150 hover:scale-110"
            style={accentStyle}
          >
            {ended ? (
              <RotateCcw className="h-7 w-7" />
            ) : (
              <Play className="ml-1 h-7 w-7 fill-current" />
            )}
          </button>
        )}

        {/* CTA overlay */}
        {cta && ctaVisible && (
          <div className="absolute bottom-16 right-4 z-30">
            <button
              type="button"
              onClick={handleCta}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg transition-transform duration-150 hover:scale-[1.04]"
              style={cta.color ? { backgroundColor: cta.color } : accentStyle}
            >
              {cta.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Viewer-email watermark */}
        {watermarkEmail && (
          <div
            className={cn(
              "pointer-events-none absolute z-40 select-none rounded bg-black/10 px-2 py-1 text-xs font-medium tracking-wide text-white/30 transition-all duration-700",
              WATERMARK_POSITIONS[watermarkIdx % WATERMARK_POSITIONS.length] ??
                "left-4 top-4",
            )}
          >
            {watermarkEmail}
          </div>
        )}

        {/* Speed menu */}
        {menu === "speed" && (
          <div
            data-player-menu
            className="absolute bottom-14 right-3 z-40 min-w-36 rounded-lg border border-white/10 bg-black/90 p-1 text-sm text-white shadow-xl backdrop-blur-sm"
          >
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-white/50">
              Playback speed
            </p>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) v.playbackRate = s;
                  setMenu(null);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-white/10"
              >
                <span>{s === 1 ? "Normal" : `${s}×`}</span>
                {rate === s && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}

        {/* Chapters menu */}
        {menu === "chapters" && chapters && chapters.length > 0 && (
          <div
            data-player-menu
            className="absolute bottom-14 right-3 z-40 max-h-56 w-64 overflow-y-auto rounded-lg border border-white/10 bg-black/90 p-1 text-sm text-white shadow-xl backdrop-blur-sm"
          >
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-white/50">
              Chapters
            </p>
            {[...chapters]
              .sort((a, b) => a.startMs - b.startMs)
              .map((chapter, i) => (
                <button
                  key={`${chapter.startMs}-${i}`}
                  type="button"
                  onClick={() => {
                    seekToMs(chapter.startMs);
                    setMenu(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/10",
                    currentChapter?.startMs === chapter.startMs && "bg-white/10",
                  )}
                >
                  <span className="w-10 shrink-0 text-xs tabular-nums text-white/60">
                    {formatDuration(chapter.startMs)}
                  </span>
                  <span className="truncate">{chapter.title}</span>
                </button>
              ))}
          </div>
        )}

        {/* Bottom control bar */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-10 transition-opacity duration-200",
            controlsShown ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {/* Seek bar */}
          <div
            ref={seekBarRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalMs)}
            aria-valuenow={Math.round(displayMs)}
            className="group/seek relative flex h-5 cursor-pointer items-center"
            onPointerDown={handleSeekDown}
            onPointerMove={handleSeekMove}
            onPointerUp={handleSeekUp}
            onPointerLeave={() => setHoverFraction(null)}
          >
            <div className="relative h-1 w-full overflow-visible rounded-full bg-white/25 transition-[height] duration-150 group-hover/seek:h-1.5">
              {/* Buffered ranges */}
              {buffered.map((range, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 rounded-full bg-white/30"
                  style={{
                    left: `${range.start * 100}%`,
                    width: `${Math.max(0, range.end - range.start) * 100}%`,
                  }}
                />
              ))}
              {/* Played */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${playedFraction * 100}%`, ...accentStyle }}
              />
              {/* Chapter tick marks */}
              {totalMs > 0 &&
                chapters
                  ?.filter((c) => c.startMs > 0 && c.startMs < totalMs)
                  .map((chapter, i) => (
                    <div
                      key={`tick-${chapter.startMs}-${i}`}
                      className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-white/80"
                      style={{ left: `${(chapter.startMs / totalMs) * 100}%` }}
                    />
                  ))}
              {/* Scrub handle */}
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity duration-150 group-hover/seek:opacity-100"
                style={{ left: `${playedFraction * 100}%` }}
              />
            </div>
            {/* Hover time tooltip */}
            {hoverMs !== null && totalMs > 0 && (
              <div
                className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-2 py-1 text-xs text-white shadow-lg"
                style={{
                  left: `${Math.min(0.94, Math.max(0.06, hoverFraction ?? 0)) * 100}%`,
                }}
              >
                {hoverChapter && (
                  <span className="mr-1.5 text-white/70">{hoverChapter.title} ·</span>
                )}
                <span className="tabular-nums">{formatDuration(hoverMs)}</span>
              </div>
            )}
          </div>

          {/* Buttons row */}
          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className={controlBtn}
            >
              {playing ? (
                <Pause className="h-4.5 w-4.5 fill-current" />
              ) : (
                <Play className="ml-0.5 h-4.5 w-4.5 fill-current" />
              )}
            </button>

            {/* Volume */}
            <div className="group/vol flex items-center">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className={controlBtn}
              >
                <VolumeIcon className="h-4.5 w-4.5" />
              </button>
              <div className="w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-[72px]">
                <div
                  ref={volumeBarRef}
                  role="slider"
                  aria-label="Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
                  className="relative mx-1.5 h-1 w-[60px] cursor-pointer rounded-full bg-white/30"
                  onPointerDown={handleVolumeDown}
                  onPointerMove={handleVolumeMove}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white"
                    style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <span className="ml-1 text-xs tabular-nums text-white/90">
              {formatDuration(Math.round(displayMs))}
              <span className="text-white/50"> / {formatDuration(totalMs)}</span>
            </span>

            {currentChapter && (
              <span className="ml-2 hidden max-w-44 truncate text-xs text-white/60 sm:inline">
                {currentChapter.title}
              </span>
            )}

            <div className="flex-1" />

            {/* Speed */}
            <button
              type="button"
              data-player-menu
              onClick={() => setMenu((m) => (m === "speed" ? null : "speed"))}
              aria-label="Playback speed"
              className={cn(
                controlBtn,
                "w-auto px-2 text-xs font-semibold tabular-nums",
                menu === "speed" && "bg-white/15",
              )}
            >
              {rate === 1 ? "1×" : `${rate}×`}
            </button>

            {/* Captions */}
            {captionsUrl && (
              <button
                type="button"
                onClick={() => setCaptionsOn((p) => !p)}
                aria-label={captionsOn ? "Hide captions" : "Show captions"}
                aria-pressed={captionsOn}
                className={cn(controlBtn, captionsOn && "bg-white/15")}
              >
                <Captions className="h-4.5 w-4.5" />
              </button>
            )}

            {/* Chapters */}
            {chapters && chapters.length > 0 && (
              <button
                type="button"
                data-player-menu
                onClick={() => setMenu((m) => (m === "chapters" ? null : "chapters"))}
                aria-label="Chapters"
                className={cn(controlBtn, menu === "chapters" && "bg-white/15")}
              >
                <ListVideo className="h-4.5 w-4.5" />
              </button>
            )}

            {/* Picture in picture */}
            {pipSupported && (
              <button
                type="button"
                onClick={() => void togglePip()}
                aria-label="Picture in picture"
                className={controlBtn}
              >
                <PictureInPicture2 className="h-4.5 w-4.5" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className={controlBtn}
            >
              {isFullscreen ? (
                <Minimize className="h-4.5 w-4.5" />
              ) : (
                <Maximize className="h-4.5 w-4.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  },
);
