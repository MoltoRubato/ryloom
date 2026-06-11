"use client";

import { useEffect, useRef, useState } from "react";
import { PictureInPicture2, X } from "lucide-react";

import { type BubblePosition, type BubbleSize, BUBBLE_SIZES } from "@/lib/recorder/engine";
import { type BubbleFrame, FRAME_GRADIENT_STOPS } from "@/lib/recorder/effects";
import { cn } from "@/lib/utils";

const SIZE_LABELS: Record<BubbleSize, string> = { 160: "S", 220: "M", 320: "L" };

/**
 * The presenter's draggable self-view bubble — what you see is what viewers
 * get. Its normalized center position is reported on drag so the engine
 * composites the recorded bubble at exactly the same spot, and the S/M/L
 * hover controls resize both in lockstep (desktop-app parity).
 */
export function CameraBubble({
  stream,
  position,
  size,
  frame,
  onPositionChange,
  onSizeChange,
  onHide,
  onPopOut,
}: {
  stream: MediaStream | null;
  /** Normalized bubble center (0..1 of the viewport — and of the recording). */
  position: BubblePosition;
  size: BubbleSize;
  frame: BubbleFrame;
  onPositionChange: (position: BubblePosition) => void;
  onSizeChange: (size: BubbleSize) => void;
  /** Hides the bubble AND removes the camera from the recording. */
  onHide?: () => void;
  /** Pops the bubble out into an always-on-top PiP window. */
  onPopOut?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Re-render on resize so the px position derived from the normalized
  // center stays glued to the right spot.
  const [, setViewport] = useState(0);

  useEffect(() => {
    const onResize = () => setViewport((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) void video.play().catch(() => undefined);
    }
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  if (!stream || typeof window === "undefined") return null;

  const radius = size / 2;
  const cx = clamp(position.x * window.innerWidth, radius, window.innerWidth - radius);
  const cy = clamp(position.y * window.innerHeight, radius, window.innerHeight - radius);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - cx,
      offsetY: event.clientY - cy,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = clamp(event.clientX - drag.offsetX, radius, window.innerWidth - radius);
    const nextY = clamp(event.clientY - drag.offsetY, radius, window.innerHeight - radius);
    onPositionChange({ x: nextX / window.innerWidth, y: nextY / window.innerHeight });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture already released
    }
  };

  return (
    <div
      className={cn(
        "group fixed z-40 touch-none select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        width: size,
        height: size,
        left: cx - radius,
        top: cy - radius,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="Drag to move your camera — viewers see it exactly here"
    >
      <div
        className="h-full w-full overflow-hidden bg-black shadow-2xl"
        style={{
          borderRadius: frame === "square" ? "22%" : "9999px",
          ...(frame === "gradient"
            ? {
                border: "4px solid transparent",
                background: `linear-gradient(#17151f, #17151f) padding-box, linear-gradient(135deg, ${FRAME_GRADIENT_STOPS[0]}, ${FRAME_GRADIENT_STOPS[1]}) border-box`,
              }
            : frame === "none"
              ? {}
              : { border: "4px solid rgba(255, 255, 255, 0.9)" }),
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full -scale-x-100 object-cover"
          style={{ borderRadius: frame === "square" ? "18%" : "9999px" }}
        />
      </div>

      {/* Hover controls — S/M/L size + hide, like the desktop bubble. */}
      <div
        className="absolute bottom-[10%] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {BUBBLE_SIZES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onSizeChange(candidate)}
            title={`${candidate}px bubble`}
            className={cn(
              "h-6 w-6 rounded-full text-[11px] font-semibold transition-colors",
              candidate === size
                ? "bg-white text-black"
                : "text-white/80 hover:bg-white/20 hover:text-white",
            )}
          >
            {SIZE_LABELS[candidate]}
          </button>
        ))}
        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            title="Keep on top — pop the bubble out so it stays visible across tabs and apps"
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            title="Hide camera (removes it from the recording)"
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
