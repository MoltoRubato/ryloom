import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

const STDERR_TAIL_BYTES = 8_192;

type RunResult = { stdout: Buffer; stderr: string };

/**
 * Spawns a binary and resolves with captured output. On a non-zero exit code
 * the error message includes the tail of stderr so job failures are debuggable
 * straight from processing_jobs.error_message.
 */
function run(
  bin: string,
  args: string[],
  opts: { captureStdout?: boolean } = {},
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args);
    child.stdin.end();

    const stdoutChunks: Buffer[] = [];
    let stderrTail = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (opts.captureStdout) stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString("utf8");
      if (stderrTail.length > STDERR_TAIL_BYTES) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_BYTES);
      }
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr: stderrTail });
      } else {
        reject(
          new Error(
            `${bin} exited with code ${code ?? "null"} (args: ${args.join(" ")})\n--- stderr tail ---\n${stderrTail}`,
          ),
        );
      }
    });
  });
}

function ffmpeg(args: string[], opts: { captureStdout?: boolean } = {}): Promise<RunResult> {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], opts);
}

function ffprobe(args: string[]): Promise<RunResult> {
  return run("ffprobe", ["-hide_banner", ...args], { captureStdout: true });
}

/**
 * Even-dimension downscale filter, capped at maxHeight, never upscaling.
 * `trunc(d/2)*2` keeps both dimensions even for yuv420p/libx264.
 */
function scaleFilter(maxHeight: number): string {
  return `scale=trunc(iw*min(1\\,${maxHeight}/ih)/2)*2:trunc(ih*min(1\\,${maxHeight}/ih)/2)*2`;
}

/** The width/height the scale filter above will produce, computed in JS. */
export function fitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = Math.min(1, maxHeight / srcHeight);
  return {
    width: Math.trunc((srcWidth * ratio) / 2) * 2,
    height: Math.trunc((srcHeight * ratio) / 2) * 2,
  };
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export type ProbeResult = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string };
};

function parseFps(stream: FfprobeStream): number {
  for (const raw of [stream.avg_frame_rate, stream.r_frame_rate]) {
    if (!raw || raw === "0/0") continue;
    const [num, den] = raw.split("/");
    const n = Number(num);
    const d = den === undefined ? 1 : Number(den);
    if (Number.isFinite(n) && Number.isFinite(d) && d > 0 && n > 0) {
      return Math.round(n / d);
    }
  }
  return 30;
}

/**
 * Probes a media file. MediaRecorder-produced WebM often lacks a container
 * duration, so when ffprobe reports none we decode the file with `-f null`
 * and parse the final `time=` from FFmpeg's progress output.
 */
export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await ffprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const parsed = JSON.parse(stdout.toString("utf8")) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");

  let durationSec = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    const streamDur = streams
      .map((s) => Number(s.duration))
      .filter((d) => Number.isFinite(d) && d > 0);
    durationSec = streamDur.length > 0 ? Math.max(...streamDur) : NaN;
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    // Decode pass — slow but reliable for headerless WebM.
    const { stderr } = await ffmpeg(["-i", file, "-f", "null", "-"]);
    const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = matches[matches.length - 1];
    if (last) {
      durationSec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
    }
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) durationSec = 0;

  return {
    durationMs: Math.round(durationSec * 1000),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: videoStream ? parseFps(videoStream) : 0,
    hasAudio,
  };
}

// ---------------------------------------------------------------------------
// Transcode / thumbnails / preview / waveform
// ---------------------------------------------------------------------------

export async function transcodeMp4(params: {
  input: string;
  output: string;
  maxHeight: number;
  hasAudio: boolean;
}): Promise<void> {
  const args = [
    "-i",
    params.input,
    "-vf",
    scaleFilter(params.maxHeight),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ];
  if (params.hasAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }
  args.push(params.output);
  await ffmpeg(args);
}

export async function thumbnail(input: string, output: string, atMs: number): Promise<void> {
  const at = Math.max(0, atMs / 1000).toFixed(3);
  await ffmpeg([
    "-ss",
    at,
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    "scale=-2:'min(ih,720)'",
    "-q:v",
    "3",
    output,
  ]);
}

/** 3-second animated preview starting ~10% in: 480px wide, 12 fps, palette-optimized. */
export async function gifPreview(
  input: string,
  output: string,
  durationMs: number,
): Promise<void> {
  const durationSec = durationMs / 1000;
  const clipLen = Math.min(3, Math.max(0.5, durationSec));
  const start = Math.max(0, Math.min(durationSec * 0.1, durationSec - clipLen));
  await ffmpeg([
    "-ss",
    start.toFixed(3),
    "-t",
    clipLen.toFixed(3),
    "-i",
    input,
    "-filter_complex",
    "[0:v]fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop",
    "0",
    output,
  ]);
}

const WAVEFORM_BUCKETS = 200;

/**
 * Decodes audio to mono 8kHz signed-16 PCM in memory and reduces it to 200
 * normalized RMS peaks. Returns all-zero peaks when there's no audio.
 */
export async function waveformJson(
  input: string,
  hasAudio: boolean,
): Promise<{ peaks: number[] }> {
  if (!hasAudio) {
    return { peaks: new Array<number>(WAVEFORM_BUCKETS).fill(0) };
  }
  const { stdout } = await ffmpeg(
    [
      "-i",
      input,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { captureStdout: true },
  );

  const sampleCount = Math.floor(stdout.length / 2);
  if (sampleCount === 0) {
    return { peaks: new Array<number>(WAVEFORM_BUCKETS).fill(0) };
  }

  const bucketSize = Math.max(1, Math.floor(sampleCount / WAVEFORM_BUCKETS));
  const peaks: number[] = [];
  for (let b = 0; b < WAVEFORM_BUCKETS; b++) {
    const start = b * bucketSize;
    const end = Math.min(sampleCount, start + bucketSize);
    if (start >= sampleCount) {
      peaks.push(0);
      continue;
    }
    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      const sample = stdout.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    peaks.push(Math.sqrt(sumSquares / Math.max(1, end - start)));
  }
  const max = Math.max(...peaks, 0.000001);
  return { peaks: peaks.map((p) => Math.round((p / max) * 1000) / 1000) };
}

// ---------------------------------------------------------------------------
// HLS ladder
// ---------------------------------------------------------------------------

export type HlsRendition = {
  height: number;
  width: number;
  bandwidth: number;
  playlist: string;
};

const LADDER_HEIGHTS = [2160, 1080, 720, 360];

const BANDWIDTH_BY_HEIGHT: Record<number, number> = {
  2160: 14_000_000,
  1080: 5_500_000,
  720: 2_800_000,
  360: 900_000,
};

/**
 * Renders an HLS ladder into outDir: one media playlist + .ts segments per
 * rendition and a master.m3u8 with BANDWIDTH/RESOLUTION entries. All URIs in
 * the playlists are relative so the web app's HLS proxy can rewrite them.
 */
export async function hlsLadder(params: {
  input: string;
  outDir: string;
  maxHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
}): Promise<HlsRendition[]> {
  await fs.mkdir(params.outDir, { recursive: true });

  let heights = LADDER_HEIGHTS.filter(
    (h) => h <= params.maxHeight && h <= params.sourceHeight,
  );
  if (heights.length === 0) {
    heights = [Math.min(params.maxHeight, Math.max(2, params.sourceHeight))];
  }

  const renditions: HlsRendition[] = [];
  for (const h of heights) {
    const dims = fitDimensions(params.sourceWidth, params.sourceHeight, h);
    const playlist = `${h}p.m3u8`;
    const args = [
      "-i",
      params.input,
      "-vf",
      scaleFilter(h),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
    ];
    if (params.hasAudio) {
      args.push("-c:a", "aac", "-b:a", "128k");
    } else {
      args.push("-an");
    }
    args.push(
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_filename",
      path.join(params.outDir, `${h}p_%04d.ts`),
      path.join(params.outDir, playlist),
    );
    await ffmpeg(args);
    renditions.push({
      height: dims.height,
      width: dims.width,
      bandwidth: BANDWIDTH_BY_HEIGHT[h] ?? Math.round(h * 5000),
      playlist,
    });
  }

  const sorted = [...renditions].sort((a, b) => b.height - a.height);
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    ...sorted.flatMap((r) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height}`,
      r.playlist,
    ]),
    "",
  ].join("\n");
  await fs.writeFile(path.join(params.outDir, "master.m3u8"), master, "utf8");

  return renditions;
}

// ---------------------------------------------------------------------------
// Audio extraction (for Whisper / Gemini)
// ---------------------------------------------------------------------------

/**
 * Extracts compressed mono 16kHz 32k audio; supports -ss/-t chunking.
 * Defaults to AAC (Whisper m4a path); "mp3" produces libmp3lame output for
 * the Gemini Files API (which accepts audio/mp3).
 */
export async function extractAudio(
  input: string,
  output: string,
  opts: { offsetSec?: number; durationSec?: number; format?: "aac" | "mp3" } = {},
): Promise<void> {
  const args: string[] = [];
  if (opts.offsetSec !== undefined) args.push("-ss", opts.offsetSec.toFixed(3));
  if (opts.durationSec !== undefined) args.push("-t", opts.durationSec.toFixed(3));
  const codec = opts.format === "mp3" ? "libmp3lame" : "aac";
  args.push("-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", codec, "-b:a", "32k", output);
  await ffmpeg(args);
}

// ---------------------------------------------------------------------------
// Silence detection
// ---------------------------------------------------------------------------

export type MsRange = { startMs: number; endMs: number };

/**
 * Runs FFmpeg's silencedetect filter and parses silence_start/silence_end
 * pairs from stderr. A trailing silence_start without an end is closed at
 * durationMs.
 */
export async function detectSilences(
  input: string,
  thresholdDb: number,
  minSilenceSec: number,
  durationMs: number,
): Promise<MsRange[]> {
  const { stderr } = await ffmpeg([
    "-i",
    input,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
    "-f",
    "null",
    "-",
  ]);

  const silences: MsRange[] = [];
  let openStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const startMatch = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (startMatch?.[1] !== undefined) {
      openStart = Math.max(0, Math.round(Number(startMatch[1]) * 1000));
      continue;
    }
    const endMatch = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (endMatch?.[1] !== undefined && openStart !== null) {
      const endMs = Math.min(durationMs, Math.round(Number(endMatch[1]) * 1000));
      if (endMs > openStart) silences.push({ startMs: openStart, endMs });
      openStart = null;
    }
  }
  if (openStart !== null && durationMs > openStart) {
    silences.push({ startMs: openStart, endMs: durationMs });
  }
  return silences;
}

// ---------------------------------------------------------------------------
// Cut / concat
// ---------------------------------------------------------------------------

/**
 * Re-renders a file keeping only the given ranges, using
 * trim/atrim + setpts/asetpts + concat in a single filter graph.
 */
export async function cutKeepRanges(params: {
  input: string;
  output: string;
  keepRanges: MsRange[];
  hasAudio: boolean;
}): Promise<void> {
  const { keepRanges, hasAudio } = params;
  if (keepRanges.length === 0) {
    throw new Error("cutKeepRanges requires at least one keep range");
  }

  const chains: string[] = [];
  keepRanges.forEach((r, i) => {
    const s = (r.startMs / 1000).toFixed(3);
    const e = (r.endMs / 1000).toFixed(3);
    chains.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) {
      chains.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  const concatInputs = keepRanges
    .map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`))
    .join("");
  chains.push(
    `${concatInputs}concat=n=${keepRanges.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? "[outv][outa]" : "[outv]"}`,
  );

  const args = [
    "-i",
    params.input,
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[outv]",
  ];
  if (hasAudio) args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "128k");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    params.output,
  );
  await ffmpeg(args);
}

/**
 * Concatenates arbitrary inputs by first normalizing every file to
 * 1920x1080 (letterboxed) @ 30fps H.264 with 48kHz stereo AAC — videos
 * without audio get a silent track — then joining losslessly with the
 * concat demuxer.
 */
export async function concatFiles(
  inputs: string[],
  output: string,
  workDir: string,
): Promise<void> {
  if (inputs.length === 0) throw new Error("concatFiles requires at least one input");

  const normalized: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) continue;
    const info = await probe(input);
    const out = path.join(workDir, `concat-part-${i}.mp4`);
    const args = ["-i", input];
    if (!info.hasAudio) {
      args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    }
    args.push(
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
    );
    if (!info.hasAudio) args.push("-shortest");
    args.push("-movflags", "+faststart", out);
    await ffmpeg(args);
    normalized.push(out);
  }

  const listFile = path.join(workDir, "concat-list.txt");
  const listBody = normalized
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(listFile, `${listBody}\n`, "utf8");

  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output]);
}
