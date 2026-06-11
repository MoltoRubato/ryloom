/**
 * SelfView — the presenter's floating camera bubble for the /record page.
 *
 * Uses the Document Picture-in-Picture API (Chrome/Edge 116+, Firefox 151+)
 * so the self-view is a real always-on-top OS window: it stays visible on
 * whichever tab or app the presenter switches to, and they can drag/resize it
 * like any window. Safari has no Document PiP — callers fall back to the
 * in-page DOM bubble.
 *
 * Capture semantics (verified empirically + via Chromium source):
 * - Tab/window captures never include the PiP window.
 * - Entire-screen ("monitor") captures historically DO include it, but
 *   Chromium's `ExcludePipFromScreenCapture` (rolling out on macOS, active in
 *   Chrome 149 here) excludes a page's own Document PiP from its own capture.
 *   Because inclusion is now per-user/per-platform, `probeCapturedInStream()`
 *   paints the PiP a sentinel color and samples one pre-recording frame to
 *   learn the truth at runtime — the recorder then either keeps compositing
 *   the camera into the canvas (PiP excluded) or lets the burned-in PiP BE
 *   the recording's bubble (PiP included).
 */

type DocumentPictureInPicture = {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  /** The browser-wide current Document PiP window, if any. */
  window?: Window | null;
};

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const SENTINEL_RGB: readonly [number, number, number] = [255, 0, 255];

const PIP_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #17151f; }
  body { display: flex; align-items: center; justify-content: center;
         font: 500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #17151f; }
  .placeholder { color: rgba(255,255,255,0.55); text-align: center; padding: 12px; }
  .sentinel { position: fixed; inset: 0; background: rgb(${SENTINEL_RGB.join(",")}); display: none; }
  .sentinel.on { display: block; }
`;

export function isSelfViewSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.documentPictureInPicture);
}

export class SelfView {
  private pipWindow: Window | null = null;
  private video: HTMLVideoElement | null = null;
  private sentinel: HTMLDivElement | null = null;
  private placeholder: HTMLDivElement | null = null;
  private closedByCode = false;
  /** Fired when the USER closes the PiP window (not programmatic close). */
  onUserClose: (() => void) | null = null;

  get isOpen(): boolean {
    return this.pipWindow !== null && !this.pipWindow.closed;
  }

  /**
   * Opens the floating self-view. Must be called with transient user
   * activation (e.g. inside the Start click handler — `requestWindow`
   * consumes the activation, so call it before anything else needs one;
   * empirically getDisplayMedia still succeeds afterwards in Chrome).
   */
  async open(): Promise<boolean> {
    if (this.isOpen) return true;
    const api = window.documentPictureInPicture;
    if (!api) return false;

    // Only one Document PiP window exists browser-wide; a stale one (e.g.
    // left over from an interrupted attempt) can wedge requestWindow.
    try {
      api.window?.close();
    } catch {
      // nothing to close
    }

    let pip: Window;
    try {
      pip = await api.requestWindow({
        width: 240,
        height: 240,
        disallowReturnToOpener: true,
      });
    } catch {
      return false;
    }

    this.pipWindow = pip;
    this.closedByCode = false;
    pip.document.title = "You — Ryloom";

    const style = pip.document.createElement("style");
    style.textContent = PIP_CSS;
    pip.document.head.appendChild(style);

    this.placeholder = pip.document.createElement("div");
    this.placeholder.className = "placeholder";
    this.placeholder.textContent = "Camera warming up…";
    pip.document.body.appendChild(this.placeholder);

    this.sentinel = pip.document.createElement("div");
    this.sentinel.className = "sentinel";
    pip.document.body.appendChild(this.sentinel);

    pip.addEventListener("pagehide", () => {
      const userClosed = !this.closedByCode;
      this.pipWindow = null;
      this.video = null;
      this.sentinel = null;
      this.placeholder = null;
      if (userClosed) this.onUserClose?.();
    });
    return true;
  }

  /** Shows the live camera in the self-view (replaces the placeholder). */
  attachStream(stream: MediaStream | null): void {
    const pip = this.pipWindow;
    if (!pip || pip.closed) return;
    if (!stream) {
      if (this.video) {
        this.video.srcObject = null;
        this.video.remove();
        this.video = null;
      }
      return;
    }
    if (!this.video) {
      this.video = pip.document.createElement("video");
      this.video.muted = true;
      this.video.autoplay = true;
      this.video.playsInline = true;
      pip.document.body.insertBefore(this.video, this.sentinel);
    }
    this.placeholder?.remove();
    this.placeholder = null;
    if (this.video.srcObject !== stream) {
      this.video.srcObject = stream;
      void this.video.play().catch(() => undefined);
    }
  }

  /**
   * Is this PiP window visible inside the given screen-capture track?
   * Paints the sentinel, samples one downscaled frame, scans for the color.
   * Run BEFORE MediaRecorder starts — the flash must never hit the recording.
   */
  async probeCapturedInStream(screenStream: MediaStream): Promise<boolean> {
    const pip = this.pipWindow;
    const sentinel = this.sentinel;
    if (!pip || pip.closed || !sentinel) return false;

    sentinel.classList.add("on");
    try {
      // Two compositor frames for the OS capture pipeline to pick it up.
      await new Promise((resolve) => setTimeout(resolve, 450));

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream(screenStream.getVideoTracks());
      await video.play().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 350));

      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;
      const w = 480;
      const h = Math.max(2, Math.round((480 * srcH) / srcW));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      video.srcObject = null;

      const [r, g, b] = SENTINEL_RGB;
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs((data[i] ?? 0) - r) < 48 &&
          (data[i + 1] ?? 0) < 72 &&
          Math.abs((data[i + 2] ?? 0) - b) < 48
        ) {
          hits++;
        }
      }
      // The 240px PiP on even a 4K display is ≫0.05% of pixels.
      return hits / (data.length / 4) > 0.0005;
    } catch {
      return false;
    } finally {
      sentinel.classList.remove("on");
    }
  }

  close(): void {
    const pip = this.pipWindow;
    this.pipWindow = null;
    this.video = null;
    this.sentinel = null;
    this.placeholder = null;
    if (pip && !pip.closed) {
      this.closedByCode = true;
      try {
        pip.close();
      } catch {
        // already gone
      }
    }
  }
}
