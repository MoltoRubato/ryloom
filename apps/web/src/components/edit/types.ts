import { type inferRouterOutputs } from "@trpc/server";

import { type AppRouter } from "@/server/api/root";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type VideoGetOutput = RouterOutputs["video"]["get"];

/** A section of the video that is kept; everything outside is cut. */
export type KeepRange = { startMs: number; endMs: number };

/** Smallest section that may survive a cut. */
export const MIN_KEEP_MS = 200;
/** Smallest gap (cut) between two kept sections. */
export const MIN_CUT_MS = 100;
/** Server-side limit on keep ranges per trim request. */
export const MAX_KEEP_RANGES = 50;

export function clampMs(value: number, min: number, max: number): number {
  const upper = Math.max(min, max);
  return Math.min(Math.max(value, min), upper);
}

/** 95_000 → "1:35", 3_725_000 → "1:02:05". Floors instead of rounding so a
 * playhead at 0:59.9 never reads as 1:00. */
export function msToClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Parses "ss", "m:ss", "mm:ss" or "h:mm:ss" into milliseconds. */
export function parseClock(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d{1,4}$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds * 1000;
}

/** Sum of kept milliseconds for a set of ranges. */
export function keptDurationMs(ranges: KeepRange[]): number {
  return ranges.reduce((acc, r) => acc + Math.max(0, r.endMs - r.startMs), 0);
}
