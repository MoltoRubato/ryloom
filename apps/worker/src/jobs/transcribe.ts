import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

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
import { enqueueJob, type ClaimedJob } from "../queue";
import { BUCKETS, downloadToFile, publicUrl, storagePaths, uploadFile } from "../storage";
import { cleanupDir, createWorkDir, getVideoOrThrow } from "./_shared";

const transcribeInput = z.object({
  autoAi: z.boolean().nullish(),
});

const MAX_WHISPER_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 600; // 10 minutes

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

async function transcribeFile(client: OpenAI, file: string): Promise<WhisperVerbose> {
  const result = await client.audio.transcriptions.create({
    file: createReadStream(file),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
  });
  return result as unknown as WhisperVerbose;
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

  if (!env.OPENAI_API_KEY) {
    await writeFailedTranscript(video.id, "openai-whisper (skipped: no OPENAI_API_KEY configured)");
    return { skipped: "no_openai_key" };
  }

  const workDir = await createWorkDir(job.id);
  try {
    const localVideo = path.join(workDir, "playback.mp4");
    await downloadToFile(BUCKETS.processed, video.playbackUrl, localVideo);

    const info = await probe(localVideo);
    if (!info.hasAudio) {
      await writeFailedTranscript(video.id, "openai-whisper (skipped: video has no audio track)");
      return { skipped: "no_audio" };
    }

    const audioLocal = path.join(workDir, "audio.m4a");
    await extractAudio(localVideo, audioLocal);
    const audioStat = await fs.stat(audioLocal);
    const durationSec = Math.max(1, Math.round(info.durationMs / 1000));

    // --- Whisper (chunked when the audio exceeds the API size limit) ---------
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

    const fullText = textParts.join(" ").trim();
    let segments = allSegments.filter((s) => s.text.length > 0 && s.endMs > s.startMs);
    if (segments.length === 0 && fullText) {
      segments = [{ startMs: 0, endMs: info.durationMs, text: fullText }];
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
        language,
        provider: "openai-whisper",
        status: "ready",
        fullText,
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
        words: allWords.filter((w) => w.startMs >= seg.startMs && w.startMs < seg.endMs),
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
        transcriptionSeconds: durationSec,
      })
      .onConflictDoUpdate({
        target: [workspaceUsage.workspaceId, workspaceUsage.period],
        set: {
          transcriptionSeconds: sql`${workspaceUsage.transcriptionSeconds} + ${durationSec}`,
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
      language,
      segments: segments.length,
      words: allWords.length,
      chunks: chunkCount,
      transcriptionSeconds: durationSec,
      autoAi,
    };
  } finally {
    await cleanupDir(workDir);
  }
}
