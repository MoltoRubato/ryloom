"use client";

import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";

import { api } from "@/trpc/react";

const ANONYMOUS_ID_KEY = "ryloom_aid";
const HEARTBEAT_INTERVAL_MS = 5_000;

export type TrackedEventType =
  | "video_loaded"
  | "play"
  | "pause"
  | "seek"
  | "progress_25"
  | "progress_50"
  | "progress_75"
  | "complete"
  | "cta_clicked"
  | "comment_created"
  | "reaction_added"
  | "download_clicked";

/** Stable per-browser anonymous viewer id, persisted in localStorage. */
export function getAnonymousId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = nanoid();
      window.localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch {
    return nanoid();
  }
}

export type UseViewTrackingOptions = {
  videoId?: string;
  shareToken?: string;
  identityEmail?: string | null;
  /** Disable tracking entirely (e.g. owners watching their own video). */
  enabled?: boolean;
};

/**
 * Starts an analytics view session and returns `track(eventType, playheadMs)`.
 * Watch time is accumulated while playing and flushed as a heartbeat every 5s
 * and on `visibilitychange: hidden`.
 */
export function useViewTracking({
  videoId,
  shareToken,
  identityEmail,
  enabled = true,
}: UseViewTrackingOptions) {
  const startSession = api.analytics.startSession.useMutation();
  const trackEvent = api.analytics.trackEvent.useMutation();

  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const pendingRef = useRef<
    { eventType: TrackedEventType; playheadMs: number | undefined }[]
  >([]);
  const playingRef = useRef(false);
  const lastFlushAtRef = useRef<number>(Date.now());
  const lastPlayheadRef = useRef(0);

  const startSessionMutate = startSession.mutateAsync;
  const trackEventMutate = trackEvent.mutate;

  const sendEvent = useCallback(
    (
      eventType: TrackedEventType | "heartbeat",
      playheadMs: number | undefined,
      watchDeltaMs?: number,
    ) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        if (eventType !== "heartbeat") {
          pendingRef.current.push({ eventType, playheadMs });
        }
        return;
      }
      trackEventMutate({
        sessionId,
        eventType,
        playheadMs:
          playheadMs !== undefined ? Math.max(0, Math.round(playheadMs)) : undefined,
        watchDeltaMs:
          watchDeltaMs !== undefined ? Math.max(0, Math.round(watchDeltaMs)) : undefined,
      });
    },
    [trackEventMutate],
  );

  /** Sends accumulated watch time (while playing) as a heartbeat. */
  const flushWatchTime = useCallback(() => {
    const now = Date.now();
    if (!playingRef.current) {
      lastFlushAtRef.current = now;
      return;
    }
    const delta = now - lastFlushAtRef.current;
    lastFlushAtRef.current = now;
    if (delta < 250 || !sessionIdRef.current) return;
    sendEvent("heartbeat", lastPlayheadRef.current, delta);
  }, [sendEvent]);

  // Start the view session once on mount.
  useEffect(() => {
    if (!enabled || !videoId || startedRef.current) return;
    startedRef.current = true;
    void startSessionMutate({
      videoId,
      shareToken,
      anonymousViewerId: getAnonymousId(),
      identityEmail: identityEmail ?? undefined,
      referrer:
        typeof document !== "undefined" && document.referrer
          ? document.referrer
          : undefined,
    })
      .then((result) => {
        sessionIdRef.current = result.sessionId;
        // Flush events that fired before the session existed.
        const queued = pendingRef.current.splice(0, pendingRef.current.length);
        for (const event of queued) {
          sendEvent(event.eventType, event.playheadMs);
        }
      })
      .catch(() => {
        // Analytics must never break playback.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, videoId, shareToken, identityEmail]);

  // Heartbeat loop + flush when the tab is hidden.
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(flushWatchTime, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushWatchTime();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushWatchTime);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushWatchTime);
      flushWatchTime();
    };
  }, [enabled, flushWatchTime]);

  const track = useCallback(
    (eventType: TrackedEventType, playheadMs?: number) => {
      if (!enabled) return;
      if (playheadMs !== undefined) lastPlayheadRef.current = playheadMs;
      if (eventType === "play") {
        playingRef.current = true;
        lastFlushAtRef.current = Date.now();
      } else if (eventType === "pause" || eventType === "complete") {
        flushWatchTime();
        playingRef.current = false;
      }
      sendEvent(eventType, playheadMs);
    },
    [enabled, flushWatchTime, sendEvent],
  );

  return { track, anonymousId: getAnonymousId() };
}
