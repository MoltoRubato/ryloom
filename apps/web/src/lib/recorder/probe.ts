/**
 * Probes a video Blob for duration and dimensions using a temporary <video>
 * element. MediaRecorder WebM blobs report `Infinity` duration in Chromium;
 * seeking far past the end forces the browser to compute the real duration.
 */

export type ProbedVideoMetadata = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

export function probeVideoBlob(blob: Blob): Promise<ProbedVideoMetadata> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({ durationMs: null, width: null, height: null });
      return;
    }

    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    let timeout = 0;

    const finish = (durationSeconds: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const width = video.videoWidth > 0 ? video.videoWidth : null;
      const height = video.videoHeight > 0 ? video.videoHeight : null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      const durationMs =
        durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : null;
      resolve({ durationMs, width, height });
    };

    timeout = window.setTimeout(() => finish(null), 8000);

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish(video.duration);
        return;
      }
      // Chromium's Infinity-duration workaround for MediaRecorder blobs.
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        finish(video.duration);
      };
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };
    video.src = url;
  });
}
