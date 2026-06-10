/**
 * Structural types + tolerant normalizers for data coming from the
 * comment/reaction/transcript/ai/folder routers. The routers are written
 * against the shared API contract; these normalizers keep the watch surfaces
 * resilient to small shape differences (flat arrays vs. wrapped objects).
 */

export type WatchCommentAuthor = {
  id?: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

export type WatchComment = {
  id: string;
  body: string;
  timestampMs: number | null;
  parentCommentId: string | null;
  status: "open" | "resolved" | "deleted";
  authorId: string | null;
  guestName: string | null;
  createdAt: Date;
  author: WatchCommentAuthor | null;
};

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  if (record) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

export function normalizeComments(data: unknown): WatchComment[] {
  return unwrapArray(data, ["items", "comments"]).flatMap((raw) => {
    const row = asRecord(raw);
    if (!row || typeof row.id !== "string") return [];
    const author = asRecord(row.author);
    const status =
      row.status === "resolved" || row.status === "deleted" ? row.status : "open";
    return [
      {
        id: row.id,
        body: typeof row.body === "string" ? row.body : "",
        timestampMs: typeof row.timestampMs === "number" ? row.timestampMs : null,
        parentCommentId:
          typeof row.parentCommentId === "string" ? row.parentCommentId : null,
        status,
        authorId: typeof row.authorId === "string" ? row.authorId : null,
        guestName: typeof row.guestName === "string" ? row.guestName : null,
        createdAt: toDate(row.createdAt),
        author: author
          ? {
              id: typeof author.id === "string" ? author.id : undefined,
              name: typeof author.name === "string" ? author.name : null,
              email: typeof author.email === "string" ? author.email : null,
              avatarUrl: typeof author.avatarUrl === "string" ? author.avatarUrl : null,
            }
          : null,
      } satisfies WatchComment,
    ];
  });
}

export type WatchReaction = {
  id: string;
  emoji: string;
  timestampMs: number | null;
  userId: string | null;
  anonymousId: string | null;
};

export function normalizeReactions(data: unknown): WatchReaction[] {
  return unwrapArray(data, ["items", "reactions"]).flatMap((raw) => {
    const row = asRecord(raw);
    if (!row || typeof row.id !== "string" || typeof row.emoji !== "string") return [];
    return [
      {
        id: row.id,
        emoji: row.emoji,
        timestampMs: typeof row.timestampMs === "number" ? row.timestampMs : null,
        userId: typeof row.userId === "string" ? row.userId : null,
        anonymousId: typeof row.anonymousId === "string" ? row.anonymousId : null,
      } satisfies WatchReaction,
    ];
  });
}

export type WatchTranscriptSegment = {
  id: string;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string | null;
};

export type WatchTranscript = {
  status: "pending" | "processing" | "ready" | "failed";
  language: string;
  segments: WatchTranscriptSegment[];
};

export function normalizeTranscript(data: unknown): WatchTranscript | null {
  if (data === null || data === undefined) return null;
  const record = asRecord(data);
  if (!record) return null;
  // Either { transcript, segments } or a transcript row with a segments key.
  const transcript = asRecord(record.transcript) ?? record;
  const segmentsRaw = Array.isArray(record.segments)
    ? record.segments
    : Array.isArray(transcript.segments)
      ? transcript.segments
      : [];

  const segments = segmentsRaw
    .flatMap((raw) => {
      const row = asRecord(raw);
      if (!row || typeof row.id !== "string") return [];
      return [
        {
          id: row.id,
          idx: typeof row.idx === "number" ? row.idx : 0,
          startMs: typeof row.startMs === "number" ? row.startMs : 0,
          endMs: typeof row.endMs === "number" ? row.endMs : 0,
          text: typeof row.text === "string" ? row.text : "",
          speakerLabel: typeof row.speakerLabel === "string" ? row.speakerLabel : null,
        } satisfies WatchTranscriptSegment,
      ];
    })
    .sort((a, b) => a.idx - b.idx || a.startMs - b.startMs);

  const statusRaw = transcript.status;
  const status =
    statusRaw === "pending" ||
    statusRaw === "processing" ||
    statusRaw === "ready" ||
    statusRaw === "failed"
      ? statusRaw
      : "ready";

  if (segments.length === 0 && status === "ready" && !transcript.id) return null;

  return {
    status,
    language: typeof transcript.language === "string" ? transcript.language : "en",
    segments,
  };
}

export type WatchAiOutput = {
  id: string;
  type: string;
  status: "pending" | "processing" | "ready" | "failed";
  contentText: string | null;
  contentJson: Record<string, unknown> | null;
  errorMessage: string | null;
  editedByUser: boolean;
  createdAt: Date;
};

export function normalizeAiOutputs(data: unknown): WatchAiOutput[] {
  return unwrapArray(data, ["items", "outputs"]).flatMap((raw) => {
    const row = asRecord(raw);
    if (!row || typeof row.id !== "string" || typeof row.type !== "string") return [];
    const status =
      row.status === "pending" ||
      row.status === "processing" ||
      row.status === "ready" ||
      row.status === "failed"
        ? row.status
        : "pending";
    return [
      {
        id: row.id,
        type: row.type,
        status,
        contentText: typeof row.contentText === "string" ? row.contentText : null,
        contentJson: asRecord(row.contentJson),
        errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : null,
        editedByUser: row.editedByUser === true,
        createdAt: toDate(row.createdAt),
      } satisfies WatchAiOutput,
    ];
  });
}

export type WatchFolder = {
  id: string;
  name: string;
  emoji: string | null;
  isSpace: boolean;
};

export function normalizeFolders(data: unknown): WatchFolder[] {
  return unwrapArray(data, ["items", "folders"]).flatMap((raw) => {
    const outer = asRecord(raw);
    if (!outer) return [];
    // Either a folder row or { folder, videoCount }.
    const row = asRecord(outer.folder) ?? outer;
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [
      {
        id: row.id,
        name: row.name,
        emoji: typeof row.emoji === "string" ? row.emoji : null,
        isSpace: row.isSpace === true,
      } satisfies WatchFolder,
    ];
  });
}
