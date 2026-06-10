"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const SEGMENT_COUNT = 14;

/**
 * Live microphone level meter. Drives segment opacity directly through the
 * DOM on each animation frame so the meter runs at 60fps without re-renders.
 */
export function MicLevelMeter({
  stream,
  muted = false,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const segmentsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const paint = (level: number) => {
      const active = Math.round(Math.min(1, level) * SEGMENT_COUNT);
      segmentsRef.current.forEach((el, index) => {
        if (!el) return;
        el.style.opacity = index < active ? "1" : "0.18";
      });
    };

    if (!stream || muted || stream.getAudioTracks().length === 0) {
      paint(0);
      return;
    }
    if (typeof window === "undefined" || typeof AudioContext === "undefined") {
      paint(0);
      return;
    }

    const audioContext = new AudioContext();
    void audioContext.resume().catch(() => undefined);
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let rafId = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = ((data[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      paint(Math.sqrt(sum / data.length) * 4);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      if (audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, [stream, muted]);

  return (
    <div
      className={cn("flex h-2 items-center gap-1", className)}
      role="meter"
      aria-label="Microphone level"
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
        <div
          key={index}
          ref={(el) => {
            segmentsRef.current[index] = el;
          }}
          className={cn(
            "h-full flex-1 rounded-full transition-opacity duration-75",
            index < SEGMENT_COUNT * 0.7
              ? "bg-primary"
              : index < SEGMENT_COUNT * 0.9
                ? "bg-amber-500"
                : "bg-destructive",
          )}
          style={{ opacity: 0.18 }}
        />
      ))}
    </div>
  );
}
