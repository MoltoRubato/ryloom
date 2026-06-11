/**
 * Crash recovery for the browser recorder.
 *
 * Every ~1s MediaRecorder chunk is mirrored into IndexedDB while recording.
 * If the tab crashes or is closed mid-recording, the next visit to /record
 * finds the unfinished session and can rebuild the full Blob from chunks.
 *
 * Database: "ryloom-recorder"
 *   - store "chunks"   keyed by [sessionId, seq] → { sessionId, seq, data }
 *   - store "sessions" keyed by sessionId        → RecoverySession metadata
 */

const DB_NAME = "ryloom-recorder";
const DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const SESSIONS_STORE = "sessions";

export type RecoverySession = {
  sessionId: string;
  videoId: string;
  workspaceId: string;
  mimeType: string;
  /** Epoch ms when recording started. */
  startedAt: number;
  title: string;
  /**
   * Upload target captured from recording.createSession so a recovered
   * recording can be uploaded without re-creating the session.
   */
  bucket?: string;
  uploadPath?: string;
};

type ChunkRow = {
  sessionId: string;
  seq: number;
  data: Blob;
};

export function isRecoverySupported(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isRecoverySupported()) {
    return Promise.reject(new Error("IndexedDB is unavailable in this environment"));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: ["sessionId", "seq"] });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Could not open the recovery database"));
    };
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function chunkRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
}

/** Upserts the session metadata (called once when recording starts). */
export async function saveSession(session: RecoverySession): Promise<void> {
  if (!isRecoverySupported()) return;
  const db = await openDb();
  const tx = db.transaction(SESSIONS_STORE, "readwrite");
  tx.objectStore(SESSIONS_STORE).put(session);
  await txDone(tx);
}

/** Persists one MediaRecorder chunk. Chunks are keyed [sessionId, seq]. */
export async function saveChunk(sessionId: string, seq: number, data: Blob): Promise<void> {
  if (!isRecoverySupported()) return;
  const db = await openDb();
  const tx = db.transaction(CHUNKS_STORE, "readwrite");
  const row: ChunkRow = { sessionId, seq, data };
  tx.objectStore(CHUNKS_STORE).put(row);
  await txDone(tx);
}

/** Rebuilds the full recording Blob from persisted chunks, in order. */
export async function loadRecording(sessionId: string): Promise<Blob | null> {
  if (!isRecoverySupported()) return null;
  const db = await openDb();
  const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], "readonly");
  const session = (await promisify(tx.objectStore(SESSIONS_STORE).get(sessionId))) as
    | RecoverySession
    | undefined;
  const rows = (await promisify(
    tx.objectStore(CHUNKS_STORE).getAll(chunkRange(sessionId)),
  )) as ChunkRow[];
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(
    rows.map((row) => row.data),
    { type: session?.mimeType ?? "video/webm" },
  );
}

/** All sessions that were never completed/cleared, newest first. */
export async function listUnfinished(): Promise<RecoverySession[]> {
  if (!isRecoverySupported()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const sessions = (await promisify(
      tx.objectStore(SESSIONS_STORE).getAll(),
    )) as RecoverySession[];
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/** Removes a session's metadata and all of its chunks. */
export async function clear(sessionId: string): Promise<void> {
  if (!isRecoverySupported()) return;
  const db = await openDb();
  const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], "readwrite");
  tx.objectStore(SESSIONS_STORE).delete(sessionId);
  tx.objectStore(CHUNKS_STORE).delete(chunkRange(sessionId));
  await txDone(tx);
}
