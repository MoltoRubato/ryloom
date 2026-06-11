"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  CANVAS_BACKGROUND_PAINTERS,
  CANVAS_FONT_STACK,
  CANVAS_LAYOUTS,
  canvasInkColor,
  type CanvasScene,
  type CanvasSlot,
} from "@/lib/recorder/canvas-scene";

/**
 * The editable canvas page — the full-screen backdrop the presenter records
 * over (Effects → Canvas). The background is painted by the exact same
 * painter the engine composites with, and every text slot is contentEditable:
 * click it, type, and the words stream straight into the recording. Slot
 * geometry and the type scale are width-relative (vw), mirroring the
 * compositor's width-relative math, so what you see is what viewers get.
 */
export function CanvasStage({
  scene,
  onTextChange,
}: {
  scene: CanvasScene;
  onTextChange: (key: string, value: string) => void;
}) {
  const backdropRef = useRef<HTMLCanvasElement | null>(null);

  const paint = useCallback(() => {
    const canvas = backdropRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(2, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(2, Math.round(window.innerHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    CANVAS_BACKGROUND_PAINTERS[scene.background](ctx, canvas.width, canvas.height);
  }, [scene.background]);

  useEffect(() => {
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, [paint]);

  const ink = canvasInkColor(scene.background);
  const slots = CANVAS_LAYOUTS[scene.layout];

  return (
    <div className="fixed inset-0 z-0" data-canvas-stage>
      <canvas ref={backdropRef} className="absolute inset-0 h-full w-full" />
      {slots.map((slot) => (
        <SlotEditor
          key={`${scene.layout}-${slot.key}`}
          slot={slot}
          ink={ink}
          value={scene.texts[slot.key] ?? ""}
          onChange={(value) => onTextChange(slot.key, value)}
        />
      ))}
      <style>{`
        [data-canvas-stage] [contenteditable]:empty::before {
          content: attr(data-placeholder);
          opacity: 0.4;
          pointer-events: none;
        }
        [data-canvas-stage] [contenteditable]:focus {
          outline: 2px dashed rgba(127, 127, 160, 0.45);
          outline-offset: 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}

function SlotEditor({
  slot,
  ink,
  value,
  onChange,
}: {
  slot: CanvasSlot;
  ink: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Push external text (template apply / layout switch) into the DOM without
  // clobbering the caret while the presenter is typing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerText.replace(/\n$/, "") !== value && document.activeElement !== el) {
      el.innerText = value;
    }
  }, [value]);

  const lightInk = ink === "#ffffff";

  return (
    <div
      className="absolute flex items-start"
      style={{
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        width: `${slot.w * 100}%`,
        fontSize: `${slot.size * 100}vw`,
        fontFamily: CANVAS_FONT_STACK,
        fontWeight: slot.weight,
        lineHeight: slot.lineHeight,
        color: ink,
        textShadow: lightInk ? "0 0.04em 0.18em rgba(10, 8, 24, 0.35)" : undefined,
      }}
    >
      {slot.bullet && (
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{
            width: "0.36em",
            height: "0.36em",
            marginTop: "0.34em",
            marginRight: "0.59em",
            background: ink,
          }}
        />
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={slot.placeholder}
        title="Click to edit — viewers see exactly this text"
        className="min-w-8 flex-1 cursor-text whitespace-pre-wrap break-words outline-none"
        style={{
          textAlign: slot.align,
          caretColor: ink,
        }}
        onInput={(event) => onChange(event.currentTarget.innerText.replace(/\n$/, ""))}
      />
    </div>
  );
}
