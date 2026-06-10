"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration } from "@/lib/utils";
import {
  clampMs,
  MIN_CUT_MS,
  MIN_KEEP_MS,
  type KeepRange,
} from "@/components/edit/types";

type DragState =
  | { kind: "seek" }
  | { kind: "handle"; rangeIndex: number; edge: "start" | "end" };

type Cut = {
  startMs: number;
  endMs: number;
  /** Index of the keep range to the left when this is a middle cut; null for trimmed ends. */
  betweenIndex: number | null;
};

type TimelineProps = {
  durationMs: number;
  currentTimeMs: number;
  keepRanges: KeepRange[];
  waveformUrl: string | null;
  disabled?: boolean;
  onSeek: (ms: number) => void;
  onChangeRanges: (ranges: KeepRange[]) => void;
};

/**
 * Timeline strip: canvas waveform (violet bars from the worker-generated
 * peaks JSON, uniform bars otherwise), keep/cut spans with draggable trim
 * handles, removable middle cuts, and a playhead synced both ways.
 */
export function Timeline({
  durationMs,
  currentTimeMs,
  keepRanges,
  waveformUrl,
  disabled = false,
  onSeek,
  onChangeRanges,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveformLoading, setWaveformLoading] = useState<boolean>(Boolean(waveformUrl));

  // ----- Waveform data --------------------------------------------------------

  useEffect(() => {
    if (!waveformUrl) {
      setWaveformLoading(false);
      return;
    }
    const controller = new AbortController();
    setWaveformLoading(true);
    fetch(waveformUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Waveform fetch failed (${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then((json) => {
        const raw =
          json && typeof json === "object" && "peaks" in json
            ? (json as { peaks: unknown }).peaks
            : null;
        if (Array.isArray(raw)) {
          const cleaned = raw
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
            .map((n) => Math.min(1, Math.max(0, n)));
          if (cleaned.length > 0) setPeaks(cleaned);
        }
      })
      .catch(() => {
        // Fall back to uniform bars below.
      })
      .finally(() => setWaveformLoading(false));
    return () => controller.abort();
  }, [waveformUrl]);

  const fallbackPeaks = useMemo(() => Array.from({ length: 160 }, () => 0.55), []);

  // ----- Canvas drawing --------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    // The canvas carries `text-primary`, so its computed CSS color is the
    // resolved violet brand color in both light and dark mode.
    const color = getComputedStyle(canvas).color || "#625DF5";
    const data = peaks ?? fallbackPeaks;
    const barWidth = 3;
    const gap = 2;
    const step = barWidth + gap;
    const barCount = Math.max(1, Math.floor(width / step));

    for (let i = 0; i < barCount; i++) {
      const x = i * step + gap / 2;
      const t = (i + 0.5) / barCount;
      const ms = t * durationMs;
      const idx = Math.min(data.length - 1, Math.floor(t * data.length));
      const peak = data[idx] ?? 0.55;
      const barHeight = Math.max(3, peak * (height - 20));
      const y = (height - barHeight) / 2;
      const inKeep =
        durationMs <= 0 || keepRanges.some((r) => ms >= r.startMs && ms <= r.endMs);
      ctx.globalAlpha = inKeep ? 0.9 : 0.22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1.5);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [peaks, fallbackPeaks, keepRanges, durationMs]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(container);
    // Redraw when the theme class flips so the resolved primary color updates.
    const themeObserver = new MutationObserver(() => draw());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [draw]);

  // ----- Geometry helpers --------------------------------------------------------

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || durationMs <= 0) return 0;
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(t * durationMs);
    },
    [durationMs],
  );

  const pct = useCallback(
    (ms: number): number => (durationMs > 0 ? (ms / durationMs) * 100 : 0),
    [durationMs],
  );

  const cuts = useMemo<Cut[]>(() => {
    if (durationMs <= 0) return [];
    const out: Cut[] = [];
    const first = keepRanges[0];
    if (first && first.startMs > 0) {
      out.push({ startMs: 0, endMs: first.startMs, betweenIndex: null });
    }
    for (let i = 0; i < keepRanges.length - 1; i++) {
      const a = keepRanges[i];
      const b = keepRanges[i + 1];
      if (a && b && b.startMs > a.endMs) {
        out.push({ startMs: a.endMs, endMs: b.startMs, betweenIndex: i });
      }
    }
    const last = keepRanges[keepRanges.length - 1];
    if (last && last.endMs < durationMs) {
      out.push({ startMs: last.endMs, endMs: durationMs, betweenIndex: null });
    }
    return out;
  }, [keepRanges, durationMs]);

  // ----- Dragging --------------------------------------------------------

  const moveHandle = useCallback(
    (rangeIndex: number, edge: "start" | "end", ms: number) => {
      const next = keepRanges.map((r) => ({ ...r }));
      const range = next[rangeIndex];
      if (!range) return;
      if (edge === "start") {
        const prev = next[rangeIndex - 1];
        const lower = rangeIndex === 0 ? 0 : prev ? prev.endMs + MIN_CUT_MS : 0;
        const upper = range.endMs - MIN_KEEP_MS;
        range.startMs = clampMs(ms, lower, upper);
        onSeek(range.startMs);
      } else {
        const after = next[rangeIndex + 1];
        const lower = range.startMs + MIN_KEEP_MS;
        const upper = after ? after.startMs - MIN_CUT_MS : durationMs;
        range.endMs = clampMs(ms, lower, upper);
        onSeek(range.endMs);
      }
      onChangeRanges(next);
    },
    [keepRanges, durationMs, onChangeRanges, onSeek],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || durationMs <= 0) return;
    dragRef.current = { kind: "seek" };
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(msFromClientX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || disabled || durationMs <= 0) return;
    const ms = msFromClientX(e.clientX);
    if (drag.kind === "seek") onSeek(ms);
    else moveHandle(drag.rangeIndex, drag.edge, ms);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const beginHandleDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    rangeIndex: number,
    edge: "start" | "end",
  ) => {
    if (disabled || durationMs <= 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { kind: "handle", rangeIndex, edge };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const removeCut = (betweenIndex: number) => {
    const left = keepRanges[betweenIndex];
    const right = keepRanges[betweenIndex + 1];
    if (!left || !right) return;
    const merged: KeepRange = { startMs: left.startMs, endMs: right.endMs };
    const next = [
      ...keepRanges.slice(0, betweenIndex),
      merged,
      ...keepRanges.slice(betweenIndex + 2),
    ];
    onChangeRanges(next);
  };

  // ----- Render --------------------------------------------------------

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative h-24 w-full touch-none overflow-hidden rounded-xl border border-border bg-card shadow-sm",
          disabled || durationMs <= 0 ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(currentTimeMs / 1000)}
        aria-valuetext={formatDuration(currentTimeMs)}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full text-primary" />

        {waveformLoading && peaks === null && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/70">
            <Skeleton className="h-10 w-3/4 rounded-lg" />
          </div>
        )}

        {/* Dimmed cut spans (middle cuts are removable) */}
        {cuts.map((cut) => (
          <div
            key={`cut-${cut.startMs}-${cut.endMs}`}
            className="absolute inset-y-0 z-[1] bg-background/55"
            style={{
              left: `${pct(cut.startMs)}%`,
              width: `${Math.max(0, pct(cut.endMs) - pct(cut.startMs))}%`,
            }}
          >
            {cut.betweenIndex !== null && !disabled && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (cut.betweenIndex !== null) removeCut(cut.betweenIndex);
                }}
                className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Remove this cut"
                title="Remove this cut"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}

        {/* Keep spans with trim handles */}
        {durationMs > 0 &&
          keepRanges.map((range, i) => (
            <div
              key={`keep-${i}`}
              className="pointer-events-none absolute inset-y-0 z-[2] rounded-md ring-2 ring-primary/70 ring-inset"
              style={{
                left: `${pct(range.startMs)}%`,
                width: `${Math.max(0, pct(range.endMs) - pct(range.startMs))}%`,
              }}
            >
              <button
                type="button"
                onPointerDown={(e) => beginHandleDrag(e, i, "start")}
                disabled={disabled}
                className="pointer-events-auto absolute inset-y-1.5 left-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize rounded-full bg-primary shadow-sm transition-transform hover:scale-x-125"
                aria-label={`Adjust start of section ${i + 1}`}
              />
              <button
                type="button"
                onPointerDown={(e) => beginHandleDrag(e, i, "end")}
                disabled={disabled}
                className="pointer-events-auto absolute inset-y-1.5 right-0 z-10 w-2 translate-x-1/2 cursor-ew-resize rounded-full bg-primary shadow-sm transition-transform hover:scale-x-125"
                aria-label={`Adjust end of section ${i + 1}`}
              />
            </div>
          ))}

        {/* Playhead */}
        {durationMs > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-foreground"
            style={{ left: `${pct(clampMs(currentTimeMs, 0, durationMs))}%` }}
          >
            <div className="absolute -top-0 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>{formatDuration(currentTimeMs)}</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </div>
  );
}
