"use client";

import { useEffect, useRef, useState } from "react";

import { type BubbleCorner } from "@/lib/recorder/engine";
import { cn } from "@/lib/utils";

const EDGE_PADDING = 16;

/**
 * Draggable self-view bubble shown while recording in screen_camera mode.
 * This is a preview only — the actual composite is drawn on the engine's
 * offscreen canvas, so moving this bubble does not move the recorded one.
 */
export function CameraBubble({
  stream,
  corner,
  size,
}: {
  stream: MediaStream | null;
  corner: BubbleCorner;
  size: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Cap the on-page preview so a 280px composite bubble doesn't dominate
  // smaller laptop screens; the recorded bubble keeps the configured size.
  const diameter = Math.min(size, 200);

  // The <video> only exists once a position has been computed (the component
  // renders null until then), so this effect must also re-run on that flip —
  // with [stream] alone it would fire before the element mounts and the
  // bubble would stay black.
  const mounted = position !== null;
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
  }, [stream, mounted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const x = corner.endsWith("right")
      ? window.innerWidth - diameter - EDGE_PADDING * 2
      : EDGE_PADDING * 2;
    const y = corner.startsWith("bottom")
      ? window.innerHeight - diameter - 120 // keep clear of the control bar
      : EDGE_PADDING * 2 + 64;
    setPosition({
      x: Math.max(EDGE_PADDING, x),
      y: Math.max(EDGE_PADDING, y),
    });
  }, [corner, diameter]);

  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(x, EDGE_PADDING), window.innerWidth - diameter - EDGE_PADDING),
    y: Math.min(Math.max(y, EDGE_PADDING), window.innerHeight - diameter - EDGE_PADDING),
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clamp(event.clientX - drag.offsetX, event.clientY - drag.offsetY));
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

  if (!stream || !position) return null;

  return (
    <div
      className={cn(
        "fixed z-40 touch-none select-none overflow-hidden rounded-full border-4 border-white/90 bg-black shadow-2xl",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        width: diameter,
        height: diameter,
        left: position.x,
        top: position.y,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="Drag to move your self-view (preview only)"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-full w-full -scale-x-100 object-cover"
      />
    </div>
  );
}
