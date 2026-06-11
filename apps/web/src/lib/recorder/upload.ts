/**
 * Direct-to-R2 multipart upload. Video bytes go straight from the browser to
 * Cloudflare R2 via presigned part URLs (from `recording.startUpload`); they
 * never touch a Next.js API route. Each part retries independently, so a
 * dropped connection only re-sends the part in flight, not the whole file.
 */

export type UploadedPart = { partNumber: number; etag: string };

export type UploadTarget = {
  uploadId: string;
  /** Server-chosen part size in bytes; every part except the last is exactly this. */
  partSize: number;
  /** Presigned PUT URL for part i+1 at index i. */
  urls: string[];
};

export type UploadRecordingOptions = {
  blob: Blob;
  target: UploadTarget;
  onProgress?: (percent: number, bytesSent: number, bytesTotal: number) => void;
  /** All parts uploaded — pass the ETags to `recording.completeUpload`. */
  onSuccess?: (parts: UploadedPart[]) => void;
  onError?: (error: Error) => void;
};

export type UploadHandle = {
  start: () => void;
  /** Aborts in-flight part requests. Caller should also call `recording.abortUpload`. */
  abort: () => Promise<void>;
};

const PART_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1000, 3000, 5000, 10000];

type UploadSignal = {
  /** User-initiated abort (no onError). */
  aborted: boolean;
  /** A part failed fatally — stop siblings, onError still fires. */
  failed: boolean;
  xhrs: Set<XMLHttpRequest>;
};

function putPart(
  url: string,
  body: Blob,
  signal: UploadSignal,
  onPartProgress: (bytesLoaded: number) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    signal.xhrs.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onPartProgress(event.loaded);
    };
    xhr.onload = () => {
      signal.xhrs.delete(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(
            new Error(
              "The storage bucket did not expose the ETag header — add ETag to the R2 bucket's CORS ExposeHeaders.",
            ),
          );
          return;
        }
        onPartProgress(body.size);
        resolve(etag);
      } else {
        reject(new Error(`Part upload failed with HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      signal.xhrs.delete(xhr);
      reject(new Error("Network error during upload"));
    };
    xhr.onabort = () => {
      signal.xhrs.delete(xhr);
      reject(new Error("Upload aborted"));
    };
    xhr.send(body);
  });
}

export function uploadRecording(options: UploadRecordingOptions): UploadHandle {
  const { blob, target } = options;
  const signal: UploadSignal = { aborted: false, failed: false, xhrs: new Set() };
  const partCount = target.urls.length;
  const progressByPart = new Array<number>(partCount).fill(0);

  const reportProgress = () => {
    const sent = progressByPart.reduce((a, b) => a + b, 0);
    const percent = blob.size > 0 ? Math.min(100, (sent / blob.size) * 100) : 0;
    options.onProgress?.(percent, sent, blob.size);
  };

  const uploadPart = async (index: number): Promise<UploadedPart> => {
    const start = index * target.partSize;
    const body = blob.slice(start, Math.min(start + target.partSize, blob.size));
    const url = target.urls[index]!;
    let lastError: Error = new Error("Upload failed");
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (signal.aborted || signal.failed) throw new Error("Upload aborted");
      try {
        const etag = await putPart(url, body, signal, (loaded) => {
          progressByPart[index] = Math.min(loaded, body.size);
          reportProgress();
        });
        return { partNumber: index + 1, etag };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (signal.aborted || signal.failed || lastError.message.includes("ETag header")) {
          throw lastError;
        }
        progressByPart[index] = 0;
        reportProgress();
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };

  const run = async (): Promise<void> => {
    const results = new Array<UploadedPart>(partCount);
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(PART_CONCURRENCY, partCount) },
      async () => {
        for (;;) {
          const index = nextIndex++;
          if (index >= partCount) return;
          results[index] = await uploadPart(index);
        }
      },
    );
    try {
      await Promise.all(workers);
    } catch (error) {
      // One part failed fatally — stop the sibling workers' in-flight PUTs
      // instead of letting them upload the rest of the file behind onError.
      signal.failed = true;
      for (const xhr of signal.xhrs) xhr.abort();
      signal.xhrs.clear();
      throw error;
    }
    options.onSuccess?.(results);
  };

  return {
    start: () => {
      void run().catch((error: unknown) => {
        if (signal.aborted) return;
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    },
    abort: async () => {
      signal.aborted = true;
      for (const xhr of signal.xhrs) xhr.abort();
      signal.xhrs.clear();
    },
  };
}
