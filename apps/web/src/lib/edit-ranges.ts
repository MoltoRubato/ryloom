import type { EditRange } from "@ryloom/db";

/**
 * Virtual-timeline math for pending (non-destructive) edits.
 *
 * A pending edit is a list of KEEP ranges over the raw playback file's
 * timeline. Until the worker's background re-render swaps the playback file,
 * players present the *virtual* timeline (cuts removed): durations, the seek
 * bar, and the playhead all use virtual ms, while the <video> element itself
 * runs on raw ms. These helpers convert between the two.
 */

/** Sort, clamp, de-overlap, and drop degenerate ranges. */
export function normalizeKeepRanges(
  ranges: EditRange[],
  durationMs?: number | null,
): EditRange[] {
  const max = durationMs && durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
  const sorted = ranges
    .map((r) => ({
      startMs: Math.max(0, Math.min(r.startMs, max)),
      endMs: Math.max(0, Math.min(r.endMs, max)),
    }))
    .filter((r) => r.endMs - r.startMs > 1)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: EditRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, r.endMs);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Total visible duration once cuts are removed. */
export function virtualDurationMs(keeps: EditRange[]): number {
  return keeps.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
}

/** Raw playback position → position on the trimmed timeline. */
export function rawToVirtualMs(rawMs: number, keeps: EditRange[]): number {
  let virtual = 0;
  for (const r of keeps) {
    if (rawMs <= r.startMs) return virtual;
    if (rawMs < r.endMs) return virtual + (rawMs - r.startMs);
    virtual += r.endMs - r.startMs;
  }
  return virtual;
}

/** Position on the trimmed timeline → raw playback position. */
export function virtualToRawMs(virtualMs: number, keeps: EditRange[]): number {
  let remaining = Math.max(0, virtualMs);
  for (const r of keeps) {
    const len = r.endMs - r.startMs;
    if (remaining < len) return r.startMs + remaining;
    remaining -= len;
  }
  const last = keeps[keeps.length - 1];
  return last ? last.endMs : virtualMs;
}

/**
 * Where playback should actually be for a given raw position: the same
 * position if it's inside a keep range, otherwise the start of the next keep
 * range (or null when past the last one — i.e. virtual end of video).
 */
export function snapToKeepMs(rawMs: number, keeps: EditRange[]): number | null {
  for (const r of keeps) {
    if (rawMs < r.startMs) return r.startMs;
    if (rawMs < r.endMs) return rawMs;
  }
  return null;
}
