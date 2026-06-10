import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";

import {
  aiOutputs,
  transcriptSegments,
  transcripts,
  videos,
  workspaceUsage,
  type TranscriptWord,
} from "@ryloom/db";

import { db } from "../db";
import { env } from "../env";
import { extractAudio, probe } from "../ffmpeg";
import { parseJsonObject } from "../providers/llm";
import { enqueueJob, type ClaimedJob } from "../queue";
import { BUCKETS, downloadToFile, publicUrl, storagePaths, uploadFile } from "../storage";
import { cleanupDir, createWorkDir, getVideoOrThrow, type VideoRow } from "./_shared";

const transcribeInput = z.object({
  autoAi: z.boolean().nullish(),
});

const MAX_WHISPER_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 600; // 10 minutes

const MAX_GEMINI_BYTES = 19 * 1024 * 1024;
const GEMINI_CHUNK_SECONDS = 1200; // 20 minutes
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 2 * 60 * 1000;

const AUTO_AI_TYPES = ["title", "summary", "chapters", "action_items"] as const;

// Whisper verbose_json shapes (typed locally so SDK churn can't break us).
type WhisperWord = { word: string; start: number; end: number };
type WhisperSegment = { start: number; end: number; text: string };
type WhisperVerbose = {
  text: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
};

type MergedSegment = { startMs: number; endMs: number; text: string };

/** Provider-agnostic transcription outcome fed into the shared finalizer. */
type TranscriptionOutcome = {
  language: string;
  fullText: string;
  segments: MergedSegment[];
  /** Word-level timestamps — empty for Gemini (stored as null on segments). */
  words: TranscriptWord[];
  chunkCount: number;
  provider: string;
};

// ---------------------------------------------------------------------------
// Caption formatting
// ---------------------------------------------------------------------------

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatTimestamp(ms: number, decimalSep: "." | ","): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const frac = clamped % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${decimalSep}${pad(frac, 3)}`;
}

function buildVtt(segments: MergedSegment[]): string {
  const cues = segments.map(
    (seg, i) =>
      `${i + 1}\n${formatTimestamp(seg.startMs, ".")} --> ${formatTimestamp(seg.endMs, ".")}\n${seg.text}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function buildSrt(segments: MergedSegment[]): string {
  const cues = segments.map(
    (seg, i) =>
      `${i + 1}\n${formatTimestamp(seg.startMs, ",")} --> ${formatTimestamp(seg.endMs, ",")}\n${seg.text}`,
  );
  return `${cues.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replaces any existing transcript rows with a single failed marker row. */
async function writeFailedTranscript(videoId: string, providerNote: string): Promise<void> {
  await db.delete(transcripts).where(eq(transcripts.videoId, videoId));
  await db.insert(transcripts).values({
    videoId,
    status: "failed",
    provider: providerNote,
  });
}

// ---------------------------------------------------------------------------
// OpenAI Whisper path
// ---------------------------------------------------------------------------

async function transcribeFile(client: OpenAI, file: string): Promise<WhisperVerbose> {
  const result = await client.audio.transcriptions.create({
    file: createReadStream(file),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
  });
  return result as unknown as WhisperVerbose;
}

async function transcribeWithWhisper(
  localVideo: string,
  workDir: string,
  durationSec: number,
): Promise<TranscriptionOutcome> {
  const audioLocal = path.join(workDir, "audio.m4a");
  await extractAudio(localVideo, audioLocal);
  const audioStat = await fs.stat(audioLocal);

  // Chunked when the audio exceeds the API size limit.
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const allSegments: MergedSegment[] = [];
  const allWords: TranscriptWord[] = [];
  const textParts: string[] = [];
  let language = "en";
  let chunkCount = 1;

  if (audioStat.size > MAX_WHISPER_BYTES) {
    chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SECONDS));
    for (let i = 0; i < chunkCount; i++) {
      const chunkLocal = path.join(workDir, `audio-chunk-${i}.m4a`);
      await extractAudio(localVideo, chunkLocal, {
        offsetSec: i * CHUNK_SECONDS,
        durationSec: CHUNK_SECONDS,
      });
      const result = await transcribeFile(client, chunkLocal);
      const offsetMs = i * CHUNK_SECONDS * 1000;
      if (i === 0 && result.language) language = result.language;
      if (result.text.trim()) textParts.push(result.text.trim());
      for (const seg of result.segments ?? []) {
        allSegments.push({
          startMs: Math.round(seg.start * 1000) + offsetMs,
          endMs: Math.round(seg.end * 1000) + offsetMs,
          text: seg.text.trim(),
        });
      }
      for (const word of result.words ?? []) {
        allWords.push({
          word: word.word,
          startMs: Math.round(word.start * 1000) + offsetMs,
          endMs: Math.round(word.end * 1000) + offsetMs,
        });
      }
      await fs.rm(chunkLocal, { force: true });
    }
  } else {
    const result = await transcribeFile(client, audioLocal);
    if (result.language) language = result.language;
    if (result.text.trim()) textParts.push(result.text.trim());
    for (const seg of result.segments ?? []) {
      allSegments.push({
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        text: seg.text.trim(),
      });
    }
    for (const word of result.words ?? []) {
      allWords.push({
        word: word.word,
        startMs: Math.round(word.start * 1000),
        endMs: Math.round(word.end * 1000),
      });
    }
  }

  return {
    language,
    fullText: textParts.join(" ").trim(),
    segments: allSegments,
    words: allWords,
    chunkCount,
    provider: "openai-whisper",
  };
}

// ---------------------------------------------------------------------------
// Gemini path (Files API + generateContent over the OpenAI-incompatible
// audio-understanding endpoint — plain fetch, no SDK)
// ---------------------------------------------------------------------------

const GEMINI_TRANSCRIBE_PROMPT = [
  "Transcribe this audio recording verbatim.",
  "Respond with strict JSON only, exactly this shape:",
  '{"language":"en","segments":[{"startMs":0,"endMs":3500,"text":"..."}]}',
  'Rules:',
  '- "language" is the two-letter code of the spoken language.',
  "- Split the transcript into segments of at most ~15 words each, splitting on natural pauses.",
  '- "startMs" and "endMs" are integers in milliseconds from the start of the audio.',
  "- Segments must be in chronological order and must not overlap.",
  "- Transcribe exactly what is said — no commentary, no markdown, no extra fields.",
].join("\n");

const geminiTranscriptionSchema = z.object({
  language: z.string().min(1).optional(),
  segments: z
    .array(
      z.object({
        startMs: z.coerce.number(),
        endMs: z.coerce.number(),
        text: z.string(),
      }),
    )
    .default([]),
});

type GeminiTranscription = z.infer<typeof geminiTranscriptionSchema>;

type GeminiFile = { name: string; uri: string; state?: string };

function geminiKey(): string {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  return env.GEMINI_API_KEY;
}

/** Uploads a local file via the Gemini Files API resumable protocol. */
async function geminiUploadFile(localPath: string, displayName: string): Promise<GeminiFile> {
  const data = await fs.readFile(localPath);

  const startRes = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${geminiKey()}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.byteLength),
      "X-Goog-Upload-Header-Content-Type": "audio/mp3",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startRes.ok) {
    throw new Error(
      `Gemini file upload start failed (${startRes.status}): ${(await startRes.text()).slice(0, 300)}`,
    );
  }
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini file upload start returned no x-goog-upload-url header");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(data.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(data),
  });
  if (!uploadRes.ok) {
    throw new Error(
      `Gemini file upload failed (${uploadRes.status}): ${(await uploadRes.text()).slice(0, 300)}`,
    );
  }
  const body = (await uploadRes.json()) as { file?: Partial<GeminiFile> };
  if (!body.file?.name || !body.file.uri) {
    throw new Error("Gemini file upload returned no file name/uri");
  }
  return { name: body.file.name, uri: body.file.uri, state: body.file.state };
}

/** Polls GET files/{name} until the file is ACTIVE (2-minute timeout). */
async function geminiAwaitActive(name: string): Promise<void> {
  const deadline = Date.now() + GEMINI_FILE_ACTIVE_TIMEOUT_MS;
  for (;;) {
    const res = await fetch(`${GEMINI_BASE}/v1beta/${name}?key=${geminiKey()}`);
    if (!res.ok) {
      throw new Error(
        `Gemini file status check failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      );
    }
    const body = (await res.json()) as { state?: string };
    if (body.state === "ACTIVE") return;
    if (body.state === "FAILED") {
      throw new Error("Gemini file processing failed (state FAILED)");
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for Gemini file to become ACTIVE (2 minutes)");
    }
    await sleep(2_000);
  }
}

/** Best-effort delete of an uploaded Gemini file. */
async function geminiDeleteFile(name: string): Promise<void> {
  try {
    await fetch(`${GEMINI_BASE}/v1beta/${name}?key=${geminiKey()}`, { method: "DELETE" });
  } catch {
    // best-effort cleanup — Gemini auto-expires files after 48h anyway
  }
}

async function geminiGenerateTranscription(model: string, fileUri: string): Promise<string> {
  const res = await fetch(
    `${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${geminiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { file_data: { file_uri: fileUri, mime_type: "audio/mp3" } },
              { text: GEMINI_TRANSCRIBE_PROMPT },
            ],
          },
        ],
        generationConfig: { response_mime_type: "application/json" },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Gemini generateContent failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  if (!text.trim()) throw new Error("Gemini returned an empty transcription response");
  return text;
}

/** Upload → wait ACTIVE → transcribe → delete, for one audio file. */
async function geminiTranscribeChunk(
  model: string,
  chunkLocal: string,
  displayName: string,
): Promise<GeminiTranscription> {
  const uploaded = await geminiUploadFile(chunkLocal, displayName);
  try {
    if (uploaded.state !== "ACTIVE") await geminiAwaitActive(uploaded.name);
    const raw = await geminiGenerateTranscription(model, uploaded.uri);
    return geminiTranscriptionSchema.parse(parseJsonObject(raw));
  } finally {
    await geminiDeleteFile(uploaded.name);
  }
}

async function transcribeWithGemini(
  localVideo: string,
  workDir: string,
  durationSec: number,
): Promise<TranscriptionOutcome> {
  const model = env.llmProvider === "gemini" ? env.AI_MODEL : "gemini-2.5-flash";

  const audioLocal = path.join(workDir, "audio.mp3");
  await extractAudio(localVideo, audioLocal, { format: "mp3" });
  const audioStat = await fs.stat(audioLocal);

  const allSegments: MergedSegment[] = [];
  const textParts: string[] = [];
  let language = "en";
  let chunkCount = 1;

  const collect = (result: GeminiTranscription, offsetMs: number, isFirst: boolean) => {
    if (isFirst && result.language) language = result.language;
    for (const seg of result.segments) {
      const text = seg.text.trim();
      const startMs = Math.max(0, Math.round(seg.startMs)) + offsetMs;
      const endMs = Math.max(0, Math.round(seg.endMs)) + offsetMs;
      if (!text) continue;
      allSegments.push({ startMs, endMs, text });
      textParts.push(text);
    }
  };

  if (audioStat.size > MAX_GEMINI_BYTES) {
    chunkCount = Math.max(1, Math.ceil(durationSec / GEMINI_CHUNK_SECONDS));
    for (let i = 0; i < chunkCount; i++) {
      const chunkLocal = path.join(workDir, `audio-chunk-${i}.mp3`);
      await extractAudio(localVideo, chunkLocal, {
        offsetSec: i * GEMINI_CHUNK_SECONDS,
        durationSec: GEMINI_CHUNK_SECONDS,
        format: "mp3",
      });
      const result = await geminiTranscribeChunk(model, chunkLocal, `ryloom-audio-${i}.mp3`);
      collect(result, i * GEMINI_CHUNK_SECONDS * 1000, i === 0);
      await fs.rm(chunkLocal, { force: true });
    }
  } else {
    const result = await geminiTranscribeChunk(model, audioLocal, "ryloom-audio.mp3");
    collect(result, 0, true);
  }

  return {
    language,
    fullText: textParts.join(" ").trim(),
    segments: allSegments,
    words: [], // Gemini does not produce word-level timestamps
    chunkCount,
    provider: "gemini",
  };
}

// ---------------------------------------------------------------------------
// Shared post-processing (captions, db rows, usage, auto-AI chain)
// ---------------------------------------------------------------------------

async function finalizeTranscription(params: {
  video: VideoRow;
  workDir: string;
  durationMs: number;
  durationSec: number;
  outcome: TranscriptionOutcome;
  autoAi: boolean;
}): Promise<Record<string, unknown>> {
  const { video, workDir, outcome, autoAi } = params;

  let segments = outcome.segments.filter((s) => s.text.length > 0 && s.endMs > s.startMs);
  if (segments.length === 0 && outcome.fullText) {
    segments = [{ startMs: 0, endMs: params.durationMs, text: outcome.fullText }];
  }

  // --- Captions (VTT + SRT, public captions bucket) --------------------------
  const vttPath = storagePaths.captions(video.workspaceId, video.id, "en", "vtt");
  const srtPath = storagePaths.captions(video.workspaceId, video.id, "en", "srt");
  const vttLocal = path.join(workDir, "en.vtt");
  const srtLocal = path.join(workDir, "en.srt");
  await fs.writeFile(vttLocal, buildVtt(segments), "utf8");
  await fs.writeFile(srtLocal, buildSrt(segments), "utf8");
  await uploadFile(BUCKETS.captions, vttPath, vttLocal, "text/vtt", true);
  await uploadFile(BUCKETS.captions, srtPath, srtLocal, "application/x-subrip", true);

  // --- Replace the transcript + segments -------------------------------------
  await db.delete(transcripts).where(eq(transcripts.videoId, video.id));
  const [transcript] = await db
    .insert(transcripts)
    .values({
      videoId: video.id,
      language: outcome.language,
      provider: outcome.provider,
      status: "ready",
      fullText: outcome.fullText,
      vttPath,
      srtPath,
    })
    .returning();
  if (!transcript) throw new Error("Failed to insert transcript row");

  const segmentRows: (typeof transcriptSegments.$inferInsert)[] = segments.map(
    (seg, idx) => ({
      transcriptId: transcript.id,
      idx,
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text,
      words:
        outcome.words.length > 0
          ? outcome.words.filter((w) => w.startMs >= seg.startMs && w.startMs < seg.endMs)
          : null,
    }),
  );
  for (let i = 0; i < segmentRows.length; i += 200) {
    await db.insert(transcriptSegments).values(segmentRows.slice(i, i + 200));
  }

  await db
    .update(videos)
    .set({
      captionsUrl: publicUrl(BUCKETS.captions, vttPath),
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));

  // --- Usage rollup ------------------------------------------------------------
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  await db
    .insert(workspaceUsage)
    .values({
      workspaceId: video.workspaceId,
      period,
      transcriptionSeconds: params.durationSec,
    })
    .onConflictDoUpdate({
      target: [workspaceUsage.workspaceId, workspaceUsage.period],
      set: {
        transcriptionSeconds: sql`${workspaceUsage.transcriptionSeconds} + ${params.durationSec}`,
        updatedAt: new Date(),
      },
    });

  // --- Auto-AI chain -------------------------------------------------------------
  if (autoAi) {
    for (const type of AUTO_AI_TYPES) {
      const [output] = await db
        .insert(aiOutputs)
        .values({ videoId: video.id, type, status: "pending" })
        .returning();
      if (output) {
        await enqueueJob({
          videoId: video.id,
          workspaceId: video.workspaceId,
          type: "ai_generate",
          inputJson: { aiOutputId: output.id, outputType: type },
        });
      }
    }
  }

  return {
    language: outcome.language,
    segments: segments.length,
    words: outcome.words.length,
    chunks: outcome.chunkCount,
    transcriptionSeconds: params.durationSec,
    autoAi,
    provider: outcome.provider,
  };
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export async function runTranscribeJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("transcribe job is missing videoId");
  const input = transcribeInput.parse(job.inputJson);
  const autoAi = input.autoAi ?? false;
  const video = await getVideoOrThrow(job.videoId);
  if (!video.playbackUrl) throw new Error("Video has no playback MP4 to transcribe");

  const provider = env.transcribeProvider;
  if (!provider) {
    await writeFailedTranscript(
      video.id,
      "none (skipped: no OPENAI_API_KEY or GEMINI_API_KEY configured)",
    );
    return { skipped: "no_transcription_key" };
  }

  const workDir = await createWorkDir(job.id);
  try {
    const localVideo = path.join(workDir, "playback.mp4");
    await downloadToFile(BUCKETS.processed, video.playbackUrl, localVideo);

    const info = await probe(localVideo);
    if (!info.hasAudio) {
      await writeFailedTranscript(
        video.id,
        `${provider === "openai" ? "openai-whisper" : "gemini"} (skipped: video has no audio track)`,
      );
      return { skipped: "no_audio" };
    }

    const durationSec = Math.max(1, Math.round(info.durationMs / 1000));
    const outcome =
      provider === "openai"
        ? await transcribeWithWhisper(localVideo, workDir, durationSec)
        : await transcribeWithGemini(localVideo, workDir, durationSec);

    return await finalizeTranscription({
      video,
      workDir,
      durationMs: info.durationMs,
      durationSec,
      outcome,
      autoAi,
    });
  } finally {
    await cleanupDir(workDir);
  }
}
