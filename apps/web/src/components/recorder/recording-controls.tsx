"use client";

import { useEffect, useRef, useState } from "react";
import {
  GripHorizontal,
  Mic,
  MicOff,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Video,
} from "lucide-react";

import { cn, formatDuration } from "@/lib/utils";

/**
 * Floating vertical control bar shown while recording — a web port of the
 * desktop app's side toolbar (controls.html): drag grip, red Stop, timer
 * (amber while paused), Pause/Resume, Restart (immediate, re-runs the
 * countdown), arm-to-confirm Trash, then mic / camera / speaker-notes.
 */
export function RecordingControls({
  elapsedMs,
  remainingMs,
  paused,
  micEnabled,
  hasMic,
  notesOpen,
  onTogglePause,
  onToggleMic,
  onStop,
  onRestart,
  onCancel,
  onToggleNotes,
  onShowCamera,
}: {
  elapsedMs: number;
  remainingMs: number | null;
  paused: boolean;
  micEnabled: boolean;
  hasMic: boolean;
  notesOpen: boolean;
  onTogglePause: () => void;
  onToggleMic: () => void;
  onStop: () => void;
  onRestart: () => void;
  onCancel: () => void;
  onToggleNotes: () => void;
  /** Brings back the camera bubble after the user hid it. */
  onShowCamera?: () => void;
}) {
  // Two-step discard: first click arms the trash for 3s, second click fires.
  const [trashArmed, setTrashArmed] = useState(false);
  const armTimerRef = useRef<number | null>(null);

  // Drag the whole bar by its grip.
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  const handleTrash = () => {
    if (trashArmed) {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
      setTrashArmed(false);
      onCancel();
      return;
    }
    setTrashArmed(true);
    armTimerRef.current = window.setTimeout(() => setTrashArmed(false), 3000);
  };

  const handleGripDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  };

  const handleGripMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.baseX + event.clientX - drag.startX,
      y: drag.baseY + event.clientY - drag.startY,
    });
  };

  const handleGripUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture already released
    }
  };

  const lowTime = remainingMs !== null && remainingMs <= 60_000;

  return (
    <div
      className="fixed top-1/2 left-4 z-50 flex w-[60px] -translate-y-1/2 flex-col items-center gap-2 rounded-full border border-border bg-card/95 px-2 py-3 shadow-2xl backdrop-blur"
      style={{ transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))` }}
    >
      <div
        className="flex h-6 w-full cursor-grab touch-none items-center justify-center text-muted-foreground/60 active:cursor-grabbing"
        onPointerDown={handleGripDown}
        onPointerMove={handleGripMove}
        onPointerUp={handleGripUp}
        onPointerCancel={handleGripUp}
        title="Drag to move"
      >
        <GripHorizontal className="h-4 w-4" />
      </div>

      <button
        type="button"
        onClick={onStop}
        title="Stop & get link"
        aria-label="Stop recording"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f25c5c] text-white shadow-md transition-transform hover:scale-105 active:scale-95"
      >
        <Square className="h-4 w-4 fill-current" />
      </button>

      <div className="text-center">
        <p
          className={cn(
            "text-xs font-semibold tabular-nums",
            paused ? "text-amber-400" : "text-foreground",
          )}
        >
          {formatDuration(elapsedMs)}
        </p>
        {remainingMs !== null && (
          <p
            className={cn(
              "text-[10px] leading-tight tabular-nums",
              lowTime ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {formatDuration(Math.max(0, remainingMs))}
          </p>
        )}
      </div>

      <BarButton
        onClick={onTogglePause}
        title={paused ? "Resume recording" : "Pause recording"}
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </BarButton>

      <BarButton onClick={onRestart} title="Restart recording">
        <RotateCcw className="h-4 w-4" />
      </BarButton>

      <BarButton
        onClick={handleTrash}
        title={trashArmed ? "Click again to discard" : "Discard recording"}
        className={cn(
          trashArmed && "bg-destructive/20 text-destructive hover:text-destructive",
        )}
      >
        <Trash2 className="h-4 w-4" />
      </BarButton>

      <div className="h-px w-7 bg-border" />

      {hasMic && (
        <BarButton
          onClick={onToggleMic}
          title={micEnabled ? "Mute microphone" : "Unmute microphone"}
          className={cn(!micEnabled && "text-destructive hover:text-destructive")}
        >
          {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </BarButton>
      )}

      {onShowCamera && (
        <BarButton onClick={onShowCamera} title="Show your camera again">
          <Video className="h-4 w-4" />
        </BarButton>
      )}

      <BarButton
        onClick={onToggleNotes}
        title={notesOpen ? "Hide speaker notes" : "Show speaker notes"}
        className={cn(notesOpen && "bg-accent text-foreground")}
      >
        <NotebookPen className="h-4 w-4" />
      </BarButton>
    </div>
  );
}

function BarButton({
  onClick,
  title,
  className,
  children,
}: {
  onClick: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
