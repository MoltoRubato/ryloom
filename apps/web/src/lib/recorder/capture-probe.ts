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
 * Detection: flash a full-viewport sentinel-colored overlay, sample one
 * downscaled frame of the capture stream and scan for the color. Runs BEFORE
 * MediaRecorder starts, so the flash never hits the recording.
 */

const SENTINEL_RGB: readonly [number, number, number] = [255, 0, 255];

export async function probePageInStream(screenStream: MediaStream): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (screenStream.getVideoTracks().length === 0) return false;

  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    `background: rgb(${SENTINEL_RGB.join(",")})`,
    "z-index: 2147483647",
    "pointer-events: none",
  ].join(";");
  document.body.appendChild(overlay);

  try {
    // Give the compositor + OS capture pipeline time to show the overlay.
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

    const [r, , b] = SENTINEL_RGB;
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
    // A full-viewport flash covers a big share of any capture that shows the
    // page at all; 2% tolerates window chrome, scaling and color management.
    return hits / (data.length / 4) > 0.02;
  } catch {
    return false;
  } finally {
    overlay.remove();
  }
}
