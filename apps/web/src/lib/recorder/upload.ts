/**
 * TUS resumable upload to Supabase Storage — implements the upload contract
 * from docs/CONTEXT.md exactly. Video bytes go straight from the browser to
 * Supabase Storage; they never touch a Next.js API route.
 */

import * as tus from "tus-js-client";

export type UploadRecordingOptions = {
  blob: Blob;
  bucket: string;
  uploadPath: string;
  /** `${SUPABASE_URL}/storage/v1/upload/resumable` — from recording.createSession. */
  tusEndpoint: string;
  mimeType: string;
  /** Supabase user access token; storage RLS allows workspace members. */
  accessToken: string;
  onProgress?: (percent: number, bytesSent: number, bytesTotal: number) => void;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

export type UploadHandle = {
  /** Starts (or resumes — interrupted uploads are picked up by fingerprint). */
  start: () => void;
  /** Aborts the upload; attempts to terminate the partial object server-side. */
  abort: () => Promise<void>;
};

export function uploadRecording(options: UploadRecordingOptions): UploadHandle {
  const upload = new tus.Upload(options.blob, {
    endpoint: options.tusEndpoint,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    // Supabase requires exactly 6MB chunks for resumable uploads.
    chunkSize: 6 * 1024 * 1024,
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "x-upsert": "true",
    },
    metadata: {
      bucketName: options.bucket,
      objectName: options.uploadPath,
      contentType: options.mimeType,
      cacheControl: "3600",
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    onProgress: (bytesSent, bytesTotal) => {
      const percent = bytesTotal > 0 ? Math.min(100, (bytesSent / bytesTotal) * 100) : 0;
      options.onProgress?.(percent, bytesSent, bytesTotal);
    },
    onSuccess: () => {
      options.onSuccess?.();
    },
    onError: (error) => {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });

  return {
    start: () => {
      // Resume an interrupted upload of the same blob when one exists —
      // fingerprints only survive failures (removed on success), so any match
      // is a partial upload we can continue instead of restarting.
      upload
        .findPreviousUploads()
        .then((previousUploads) => {
          const previous = previousUploads[0];
          if (previous) upload.resumeFromPreviousUpload(previous);
          upload.start();
        })
        .catch(() => {
          upload.start();
        });
    },
    abort: async () => {
      try {
        // true → also terminate the partial upload server-side.
        await upload.abort(true);
      } catch {
        await upload.abort().catch(() => undefined);
      }
    },
  };
}
