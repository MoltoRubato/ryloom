/**
 * PiP bubble — keeps the presenter's self-view on top of EVERYTHING while
 * recording, like the desktop app's floating always-on-top bubble window.
 *
 * Built on the Document Picture-in-Picture API (Chrome/Edge 116+): the camera
 * video moves into a small always-on-top window that survives tab switches
 * and app switches. Three ways it opens, all needed because requestWindow()
 * consumes a user gesture and screen capture needs one too:
 *
 *  1. Right after capture starts — works when the share-picker round trip
 *     was quick enough that the original click's activation is still live.
 *  2. Automatically on tab switch via the Media Session
 *     "enterpictureinpicture" action — Chrome fires it for camera/mic-using
 *     pages when the user leaves the tab (no gesture required inside it).
 *  3. Manually from the pop-out button on the in-page bubble (always works).
 *
 * The PiP window shows the PROCESSED camera stream, so Clear/Blur/replacement
 * backgrounds and frame styles look identical to what viewers get.
 */

import {
  FRAME_GRADIENT_STOPS,
  type BubbleFrame,
} from "./effects";
import { BUBBLE_SIZES, type BubbleCorner, type BubbleSize } from "./engine";

type DocumentPictureInPicture = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isDocumentPipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

export type PipBubbleHandle = {
  setStream(stream: MediaStream | null): void;
  setFrame(frame: BubbleFrame): void;
  setSize(size: BubbleSize): void;
  close(): void;
  readonly isOpen: boolean;
};

export type PipBubbleOptions = {
  stream: MediaStream | null;
  frame: BubbleFrame;
  size: BubbleSize;
  /** Snap the recorded (composited) bubble to a corner. */
  onCorner: (corner: BubbleCorner) => void;
  /** S/M/L — resizes the recorded bubble. */
  onSizeChange: (size: BubbleSize) => void;
  /** ✕ — hide the camera from the recording entirely. */
  onHide: () => void;
  /** Fired whenever the PiP window closes, for any reason. */
  onClosed: () => void;
};

const SIZE_LABELS: Record<BubbleSize, string> = { 160: "S", 220: "M", 320: "L" };

const PIP_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #0d0c13; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { position: relative; width: 100%; height: 100%; }
  video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #17151f; }
  .wrap.frame-square video { border-radius: 0; }
  .wrap.frame-gradient::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    border: 4px solid transparent;
    background: linear-gradient(135deg, ${FRAME_GRADIENT_STOPS[0]}, ${FRAME_GRADIENT_STOPS[1]}) border-box;
    -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude; }
  .wrap.frame-circle::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    border: 4px solid rgba(255, 255, 255, 0.35); }
  .controls { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 4px; padding: 5px;
    border-radius: 999px; background: rgba(13, 12, 19, 0.82); backdrop-filter: blur(6px);
    opacity: 0; transition: opacity 0.18s ease; }
  .wrap:hover .controls { opacity: 1; }
  .controls button { appearance: none; border: none; background: transparent;
    color: rgba(255, 255, 255, 0.85); font: 700 11px/1 inherit; width: 24px; height: 24px;
    border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .controls button:hover { background: rgba(255, 255, 255, 0.16); }
  .controls button.active { background: #625df5; color: #fff; }
  .controls button.close:hover { background: rgba(242, 92, 92, 0.85); }
  .controls .sep { width: 1px; height: 14px; background: rgba(255, 255, 255, 0.18); }
  .corner-icon { display: block; width: 11px; height: 11px;
    border: 1.5px solid currentColor; border-radius: 2px; position: relative; }
  .corner-icon::after { content: ""; position: absolute; width: 4px; height: 4px;
    border-radius: 1px; background: currentColor; }
  .corner-icon.tl::after { top: 0.5px; left: 0.5px; }
  .corner-icon.tr::after { top: 0.5px; right: 0.5px; }
  .corner-icon.bl::after { bottom: 0.5px; left: 0.5px; }
  .corner-icon.br::after { bottom: 0.5px; right: 0.5px; }
  .hint { position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    padding: 3px 9px; border-radius: 999px; background: rgba(13, 12, 19, 0.82);
    color: rgba(255, 255, 255, 0.75); font-size: 10px; white-space: nowrap;
    opacity: 0; transition: opacity 0.18s ease; pointer-events: none; }
  .wrap:hover .hint { opacity: 1; }
`;

/**
 * Opens the always-on-top PiP bubble. Resolves null when unsupported or the
 * browser refuses (e.g. the user gesture already expired) — callers fall back
 * to the in-page bubble and the auto/manual paths.
 */
export async function openPipBubble(options: PipBubbleOptions): Promise<PipBubbleHandle | null> {
  const api = typeof window === "undefined" ? undefined : window.documentPictureInPicture;
  if (!api) return null;

  let pipWindow: Window;
  try {
    pipWindow = await api.requestWindow({ width: 280, height: 280 });
  } catch {
    return null;
  }

  const doc = pipWindow.document;
  doc.title = "Ryloom — camera";
  const style = doc.createElement("style");
  style.textContent = PIP_CSS;
  doc.head.appendChild(style);

  const wrap = doc.createElement("div");
  wrap.className = `wrap frame-${options.frame}`;

  const video = doc.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  wrap.appendChild(video);

  const hint = doc.createElement("div");
  hint.className = "hint";
  hint.textContent = "Always on top while you record";
  wrap.appendChild(hint);

  const controls = doc.createElement("div");
  controls.className = "controls";
  wrap.appendChild(controls);
  doc.body.appendChild(wrap);

  let closed = false;
  let currentSize = options.size;

  const sizeButtons = new Map<BubbleSize, HTMLButtonElement>();
  for (const candidate of BUBBLE_SIZES) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = SIZE_LABELS[candidate];
    button.title = `${candidate}px bubble in the recording`;
    button.addEventListener("click", () => {
      currentSize = candidate;
      for (const [size, el] of sizeButtons) el.classList.toggle("active", size === candidate);
      options.onSizeChange(candidate);
    });
    button.classList.toggle("active", candidate === currentSize);
    sizeButtons.set(candidate, button);
    controls.appendChild(button);
  }

  const sep = doc.createElement("div");
  sep.className = "sep";
  controls.appendChild(sep);

  const corners: Array<[BubbleCorner, string, string]> = [
    ["top-left", "tl", "Snap recorded bubble to the top left"],
    ["top-right", "tr", "Snap recorded bubble to the top right"],
    ["bottom-left", "bl", "Snap recorded bubble to the bottom left"],
    ["bottom-right", "br", "Snap recorded bubble to the bottom right"],
  ];
  for (const [corner, cls, title] of corners) {
    const button = doc.createElement("button");
    button.type = "button";
    button.title = title;
    const icon = doc.createElement("span");
    icon.className = `corner-icon ${cls}`;
    button.appendChild(icon);
    button.addEventListener("click", () => options.onCorner(corner));
    controls.appendChild(button);
  }

  const sep2 = doc.createElement("div");
  sep2.className = "sep";
  controls.appendChild(sep2);

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.textContent = "✕";
  closeButton.title = "Hide camera (removes it from the recording)";
  closeButton.addEventListener("click", () => {
    options.onHide();
    pipWindow.close();
  });
  controls.appendChild(closeButton);

  const attach = (stream: MediaStream | null) => {
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  };
  attach(options.stream);

  pipWindow.addEventListener("pagehide", () => {
    if (closed) return;
    closed = true;
    options.onClosed();
  });

  return {
    setStream: attach,
    setFrame(frame: BubbleFrame) {
      wrap.className = `wrap frame-${frame}`;
    },
    setSize(size: BubbleSize) {
      currentSize = size;
      for (const [candidate, el] of sizeButtons) {
        el.classList.toggle("active", candidate === size);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        pipWindow.close();
      } catch {
        // window already gone
      }
    },
    get isOpen() {
      return !closed;
    },
  };
}

/**
 * Registers the Media Session "enterpictureinpicture" action so Chrome
 * auto-opens the bubble when the presenter switches tabs mid-recording —
 * the piece that makes "visible at all times" hold without an extra click.
 * Returns an unregister function.
 */
export function registerAutoPip(open: () => void): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => undefined;
  }
  try {
    // Not yet in TS's MediaSessionAction union.
    navigator.mediaSession.setActionHandler(
      "enterpictureinpicture" as MediaSessionAction,
      open,
    );
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      navigator.mediaSession.setActionHandler(
        "enterpictureinpicture" as MediaSessionAction,
        null,
      );
    } catch {
      // session already gone
    }
  };
}
