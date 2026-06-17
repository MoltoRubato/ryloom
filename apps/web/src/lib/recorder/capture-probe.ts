/**
 * Capture probe — answers "is this page visible inside that screen capture?"
 *
 * The recorder needs to know whether the in-page camera bubble is physically
 * part of the captured pixels (user picked this tab, this browser window, or
 * a monitor showing this page) or not (another window/tab/monitor):
 *  - visible  → the DOM bubble IS the bubble viewers see; compositing a
 *               second one onto the canvas would double it.
 *  - invisible → the engine must composite the camera into the canvas.
 *
 * Detection: briefly fill the viewport with a known sentinel color, sample one
 * downscaled frame of the capture stream and scan for it. This runs BEFORE
 * MediaRecorder starts, so it never reaches the recording — but it IS on the
 * presenter's screen for ~0.7s, so instead of a bare full-screen color flash
 * (which read as a "weird pink screen") the sentinel is dressed as a
 * deliberate, on-brand "Preparing your recording…" splash. The fill is the
 * Ryloom brand violet, which is a distinctive enough signature (blue channel
 * dominating two near-equal lower channels) to detect reliably while looking
 * like an intentional setup screen rather than a glitch.
 */

/** Ryloom brand violet (#625DF5) — the splash fill AND the detection target. */
const SENTINEL_RGB: readonly [number, number, number] = [98, 93, 245];

/**
 * Does this pixel look like the brand-violet sentinel? Matching a colour
 * *signature* (blue clearly dominant over two near-equal, mid-range R/G) rather
 * than a tight per-channel box keeps detection robust across the OS capture
 * pipeline's scaling and colour management, while staying specific enough that
 * arbitrary captured content almost never trips it.
 */
function looksLikeSentinel(r: number, g: number, b: number): boolean {
  return (
    b > 185 && // strong blue
    b - r > 70 && // blue clearly above red…
    b - g > 70 && // …and above green
    Math.abs(r - g) < 55 && // red ≈ green (the violet has R≈G)
    r > 40 &&
    r < 165 &&
    g > 40 &&
    g < 165
  );
}

export async function probePageInStream(screenStream: MediaStream): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (screenStream.getVideoTracks().length === 0) return false;

  const styleId = "ryloom-prepare-splash-style";
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    @keyframes ryloom-prepare-in { from { opacity: 0 } to { opacity: 1 } }
    @keyframes ryloom-prepare-spin { to { transform: rotate(360deg) } }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.setAttribute("data-ryloom-prepare", "");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    `background: rgb(${SENTINEL_RGB.join(",")})`,
    "z-index: 2147483647",
    "pointer-events: none",
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "justify-content: center",
    "gap: 22px",
    "color: #fff",
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    "animation: ryloom-prepare-in 160ms ease-out both",
  ].join(";");
  overlay.innerHTML = `
    <svg width="76" height="76" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 14px rgba(0,0,0,0.25))">
      <rect width="32" height="32" rx="8" fill="#fff" fill-opacity="0.16" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" stroke-width="2.5" />
      <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="#fff" />
    </svg>
    <div style="display:flex;align-items:center;gap:12px">
      <span style="width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(255,255,255,0.35);border-top-color:#fff;animation:ryloom-prepare-spin 800ms linear infinite"></span>
      <span style="font-size:17px;font-weight:600;letter-spacing:0.01em">Preparing your recording…</span>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    // Give the compositor + OS capture pipeline time to show the splash.
    await new Promise((resolve) => setTimeout(resolve, 420));

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(screenStream.getVideoTracks());
    await video.play().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));

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

    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (looksLikeSentinel(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) {
        hits++;
      }
    }
    // The full-viewport splash covers a big share of any capture that shows
    // the page at all; 2% tolerates window chrome, scaling and color
    // management (the logo/label sit on top but are a tiny fraction of pixels).
    return hits / (data.length / 4) > 0.02;
  } catch {
    return false;
  } finally {
    overlay.remove();
    style.remove();
  }
}
