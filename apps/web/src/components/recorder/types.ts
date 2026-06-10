/** Shared types for the /record flow. */

/**
 * Everything the browser needs to finish a recording session — captured from
 * `recording.createSession` (or rebuilt from recovery metadata).
 */
export type ActiveSession = {
  sessionId: string;
  videoId: string;
  bucket: string;
  uploadPath: string;
  tusEndpoint: string;
  /** Container mime type used when the session was created. */
  mimeType: string;
  /** Per-recording cap from the workspace plan; null = unlimited. */
  maxRecordingMinutes: number | null;
};

/** Where the blob sitting on the preview screen came from. */
export type PreviewSource = "recording" | "recovered" | "file";
