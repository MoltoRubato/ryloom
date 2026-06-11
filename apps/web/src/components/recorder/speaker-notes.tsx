"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Floating speaker-notes card — a web port of the desktop notes window
 * (notes.html): draggable header, A-/A+ font sizing (12–32px), an autosaving
 * textarea (400ms debounce) and persistent content across sessions.
 *
 * Storage matches the desktop semantics: notes are global, not per-recording.
 * Unlike the desktop window (content-protected), a web overlay CAN appear in
 * the recording if the captured screen shows this page — the footer says so.
 */

const NOTES_KEY = "ryloom.speakerNotes";
const FONT_KEY = "ryloom.speakerNotesFontSize";
const MIN_FONT = 12;
const MAX_FONT = 32;

export function SpeakerNotes({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(15);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      setText(window.localStorage.getItem(NOTES_KEY) ?? "");
      const savedFont = Number(window.localStorage.getItem(FONT_KEY));
      if (Number.isFinite(savedFont) && savedFont >= MIN_FONT && savedFont <= MAX_FONT) {
        setFontSize(savedFont);
      }
    } catch {
      // storage unavailable — notes just won't persist
    }
    setPosition({
      x: Math.max(16, window.innerWidth - 380 - 24),
      y: Math.max(16, window.innerHeight / 2 - 220),
    });
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleTextChange = (value: string) => {
    setText(value);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(NOTES_KEY, value);
      } catch {
        // storage unavailable
      }
    }, 400);
  };

  const bumpFont = (delta: number) => {
    setFontSize((current) => {
      const next = Math.min(MAX_FONT, Math.max(MIN_FONT, current + delta));
      try {
        window.localStorage.setItem(FONT_KEY, String(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.min(Math.max(event.clientX - drag.offsetX, 0), window.innerWidth - 120),
      y: Math.min(Math.max(event.clientY - drag.offsetY, 0), window.innerHeight - 60),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture already released
    }
  };

  if (!position) return null;

  return (
    <div
      className="fixed z-50 flex h-[440px] w-[380px] min-h-[260px] min-w-[280px] resize flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <p className="text-[11px] font-semibold tracking-widest text-muted-foreground">
          SPEAKER NOTES
        </p>
        <div
          className="flex items-center gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => bumpFont(-2)}
            title="Smaller text"
            className="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => bumpFont(2)}
            title="Larger text"
            className="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            A+
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close notes"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        placeholder="Jot down what you want to say…"
        spellCheck={false}
        className="flex-1 resize-none bg-transparent px-3 py-2.5 leading-relaxed outline-none placeholder:text-muted-foreground/60"
        style={{ fontSize }}
      />

      <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Autosaved · May appear in the recording if you capture this screen
      </p>
    </div>
  );
}
