import { asc, eq } from "drizzle-orm";

import { transcriptSegments, type TranscriptWord } from "@ryloom/db";

import { db } from "../db";
import { type MsRange } from "../ffmpeg";
import { type ClaimedJob } from "../queue";
import {
  cleanupDir,
  createWorkDir,
  findReadyTranscript,
  getVideoOrThrow,
  invertToKeepRanges,
  mergeRanges,
  reRenderWithKeepRanges,
  restoreVideoReady,
} from "./_shared";

const FILLER_WORDS = new Set(["um", "uh", "erm", "uhm", "hmm"]);
const CUT_LEAD_MS = 60;
const CUT_TAIL_MS = 60;
const MERGE_GAP_MS = 120;
const MIN_KEEP_MS = 120;

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export async function runFillerRemovalJob(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  if (!job.videoId) throw new Error("filler_removal job is missing videoId");
  const video = await getVideoOrThrow(job.videoId);
  if (!video.playbackUrl) throw new Error("Video has no playback MP4 to edit");

  const transcript = await findReadyTranscript(video.id);
  if (!transcript) {
    await restoreVideoReady(video.id);
    return { fillersRemoved: 0, reason: "no_transcript" };
  }

  const segments = await db.query.transcriptSegments.findMany({
    where: eq(transcriptSegments.transcriptId, transcript.id),
    orderBy: asc(transcriptSegments.idx),
  });

  const words: TranscriptWord[] = segments.flatMap((s) => s.words ?? []);
  if (words.length === 0) {
    await restoreVideoReady(video.id);
    return { fillersRemoved: 0, reason: "no_word_timestamps" };
  }

  const durationMs = video.durationMs ?? 0;
  if (durationMs <= 0) throw new Error("Video has no duration recorded");

  // Find filler occurrences: single fillers plus the "you know" bigram.
  const rawCuts: MsRange[] = [];
  let fillersRemoved = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const norm = normalizeWord(word.word);
    const next = words[i + 1];

    if (norm === "you" && next && normalizeWord(next.word) === "know") {
      rawCuts.push({
        startMs: Math.max(0, word.startMs - CUT_LEAD_MS),
        endMs: Math.min(durationMs, next.endMs + CUT_TAIL_MS),
      });
      fillersRemoved += 1;
      i += 1; // consume "know"
      continue;
    }
    if (FILLER_WORDS.has(norm)) {
      rawCuts.push({
        startMs: Math.max(0, word.startMs - CUT_LEAD_MS),
        endMs: Math.min(durationMs, word.endMs + CUT_TAIL_MS),
      });
      fillersRemoved += 1;
    }
  }

  if (rawCuts.length === 0) {
    await restoreVideoReady(video.id);
    return { fillersRemoved: 0 };
  }

  const cuts = mergeRanges(rawCuts, MERGE_GAP_MS);
  const keepRanges = invertToKeepRanges(cuts, durationMs, MIN_KEEP_MS);
  if (keepRanges.length === 0) {
    await restoreVideoReady(video.id);
    return { fillersRemoved: 0, reason: "nothing_left_to_keep" };
  }

  const workDir = await createWorkDir(job.id);
  try {
    const result = await reRenderWithKeepRanges({ job, video, workDir, keepRanges });
    return {
      fillersRemoved,
      removedMs: result.removedMs,
      durationMs: result.durationMs,
    };
  } finally {
    await cleanupDir(workDir);
  }
}
