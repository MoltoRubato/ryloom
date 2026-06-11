import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

const STDERR_TAIL_BYTES = 8_192;

/**
 * Watchdog ceilings. Any single FFmpeg invocation on our inputs (≤4K screen
 * recordings, plan-capped lengths) finishes in minutes; a run that hits these
 * is wedged or pathological and must fail the job with a real error instead
 * of zombie-ing until the Cloud Run task timeout kills the container.
 */
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 5 * 60 * 1000;

type RunResult = { stdout: Buffer; stderr: string };

/**
 * Spawns a binary and resolves with captured output. On a non-zero exit code
 * the error message includes the tail of stderr so job failures are debuggable
 * straight from processing_jobs.error_message.
 */
function run(
  bin: string,
  args: string[],
  opts: { captureStdout?: boolean; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args);
    child.stdin.end();

    const stdoutChunks: Buffer[] = [];
    let stderrTail = "";
    let timedOut = false;
    const killTimer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

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
      if (killTimer) clearTimeout(killTimer);
      reject(new Error(`Failed to spawn ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(
          new Error(
            `${bin} killed after exceeding ${Math.round((opts.timeoutMs ?? 0) / 60_000)} min (args: ${args.join(" ")})\n--- stderr tail ---\n${stderrTail}`,
          ),
        );
      } else if (code === 0) {
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
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
    ...opts,
    timeoutMs: FFMPEG_TIMEOUT_MS,
  });
}

function ffprobe(args: string[]): Promise<RunResult> {
  return run("ffprobe", ["-hide_banner", ...args], {
    captureStdout: true,
    timeoutMs: FFPROBE_TIMEOUT_MS,
  });
}

/**
 * Even-dimension downscale filter, capped at maxHeight, never upscaling.
 * `trunc(d/2)*2` keeps both dimensions even for yuv420p/libx264.
 */
function scaleFilter(maxHeight: number): string {
  return `scale=trunc(iw*min(1\\,${maxHeight}/ih)/2)*2:trunc(ih*min(1\\,${maxHeight}/ih)/2)*2:flags=lanczos`;
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
  videoCodec: string | null;
  audioCodec: string | null;
  pixFmt: string | null;
  /** ffprobe demuxer name, e.g. "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
  formatName: string;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string };
};

/** ffprobe reports the mp4/mov demuxer as a comma list ("mov,mp4,m4a,..."). */
export function isMp4Container(formatName: string): boolean {
  const names = formatName.split(",");
  return names.includes("mp4") || names.includes("mov");
}

function parseFps(stream: FfprobeStream): number {
  for (const raw of [stream.avg_frame_rate, stream.r_frame_rate]) {
    if (!raw || raw === "0/0") continue;
    const [num, den] = raw.split("/");
    const n = Number(num);
    const d = den === undefined ? 1 : Number(den);
    if (Number.isFinite(n) && Number.isFinite(d) && d > 0 && n > 0) {
      const fps = Math.round(n / d);
      // MediaRecorder WebM (canvas/tab captures) reports its 1/1000 timebase
      // as r_frame_rate=1000/1 — a container artifact, not a real frame rate.
      // Only r_frame_rate carries it; a measured avg_frame_rate (e.g. real
      // 240/360fps slow-motion footage) is always trusted.
      if (raw === stream.r_frame_rate && fps > 240) continue;
      return fps;
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
    // Demux-only pass (-c copy skips decoding) — reliable for headerless WebM.
    const { stderr } = await ffmpeg(["-i", file, "-c", "copy", "-f", "null", "-"]);
    const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = matches[matches.length - 1];
    if (last) {
      durationSec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
    }
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) durationSec = 0;

  const audioStream = streams.find((s) => s.codec_type === "audio");
  return {
    durationMs: Math.round(durationSec * 1000),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: videoStream ? parseFps(videoStream) : 0,
    hasAudio,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    pixFmt: videoStream?.pix_fmt ?? null,
    formatName: parsed.format?.format_name ?? "",
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
    // MediaRecorder WebM advertises a 1000/1 nominal rate (1ms timebase);
    // without vfr, ffmpeg ≤5.x CFR-expands a 30s clip to ~30,000 duplicated
    // frames and the encode takes hours. vfr keeps the real timestamps.
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    // CRF 19: this MP4 is the mezzanine every later edit/ladder derives from,
    // and screen content compresses well — the bitrate cost is small.
    "-crf",
    "19",
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

/**
 * Lossless container rewrite into a faststart MP4 — used when the source is
 * already H.264/AAC in an mp4/mov container (Chrome 126+ MediaRecorder), so
 * the full re-encode can be skipped entirely.
 */
export async function remuxMp4(input: string, output: string): Promise<void> {
  await ffmpeg(["-i", input, "-c", "copy", "-movflags", "+faststart", output]);
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

/** Fallback BANDWIDTH values, only used when measuring the encoded bytes fails. */
const BANDWIDTH_BY_HEIGHT: Record<number, number> = {
  2160: 14_000_000,
  1080: 5_500_000,
  720: 2_800_000,
  360: 900_000,
};

/**
 * Actual rendition bandwidth: encoded segment bytes over playlist duration,
 * plus 15% headroom. CRF screen content lands far below the nominal table
 * above — writing real numbers lets hls.js ABR actually climb rungs.
 */
async function measuredBandwidth(outDir: string, h: number): Promise<number | null> {
  try {
    const playlist = await fs.readFile(path.join(outDir, `${h}p.m3u8`), "utf8");
    let durationSec = 0;
    for (const m of playlist.matchAll(/#EXTINF:([\d.]+)/g)) durationSec += Number(m[1]);
    let bytes = 0;
    for (const name of await fs.readdir(outDir)) {
      if (name.startsWith(`${h}p_`) && name.endsWith(".ts")) {
        bytes += (await fs.stat(path.join(outDir, name))).size;
      }
    }
    if (!(durationSec > 0) || bytes <= 0) return null;
    return Math.round(((bytes * 8) / durationSec) * 1.15);
  } catch {
    return null;
  }
}

/**
 * Renders an HLS ladder into outDir: one media playlist + .ts segments per
 * rendition and a master.m3u8 with BANDWIDTH/RESOLUTION entries. All URIs in
 * the playlists are relative so the web app's HLS proxy can rewrite them.
 *
 * All encoded rungs come from ONE ffmpeg invocation (split + per-output
 * scale), so the input is decoded once instead of once per rendition.
 */
export async function hlsLadder(params: {
  input: string;
  outDir: string;
  maxHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  /**
   * Already-encoded MP4 whose streams match the source 1:1 (remux fast path).
   * Rungs at the source height are segmented from it with -c copy — no
   * re-encode, no generation loss.
   */
  copySource?: string;
}): Promise<HlsRendition[]> {
  await fs.mkdir(params.outDir, { recursive: true });

  let heights = LADDER_HEIGHTS.filter(
    (h) => h <= params.maxHeight && h <= params.sourceHeight,
  );
  if (heights.length === 0) {
    heights = [Math.min(params.maxHeight, Math.max(2, params.sourceHeight))];
  }

  const hlsMuxArgs = (h: number) => [
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
    path.join(params.outDir, `${h}p.m3u8`),
  ];

  // heights is filtered to <= sourceHeight, so h >= sourceHeight is exactly
  // the "top rung equals the source" case the copy fast path covers.
  const copyHeights = params.copySource
    ? heights.filter((h) => h >= params.sourceHeight)
    : [];
  const encodeHeights = heights.filter((h) => !copyHeights.includes(h));

  for (const h of copyHeights) {
    // Segment-only: -c copy cuts at the source's existing keyframes.
    await ffmpeg(["-i", params.copySource!, "-c", "copy", ...hlsMuxArgs(h)]);
  }

  if (encodeHeights.length > 0) {
    const chains: string[] = [];
    if (encodeHeights.length === 1) {
      chains.push(`[0:v]${scaleFilter(encodeHeights[0]!)}[v${encodeHeights[0]}]`);
    } else {
      chains.push(
        `[0:v]split=${encodeHeights.length}${encodeHeights.map((h) => `[s${h}]`).join("")}`,
      );
      for (const h of encodeHeights) chains.push(`[s${h}]${scaleFilter(h)}[v${h}]`);
    }
    const args = ["-i", params.input, "-filter_complex", chains.join(";")];
    for (const h of encodeHeights) {
      args.push("-map", `[v${h}]`);
      if (params.hasAudio) args.push("-map", "0:a:0");
      args.push(
        // vfr: see transcodeMp4 — never CFR-expand bogus 1000fps WebM rates.
        "-fps_mode",
        "vfr",
        // Force a keyframe at every segment boundary so 4s VOD segments cut
        // cleanly regardless of the source's GOP cadence.
        "-force_key_frames",
        "expr:gte(t,n_forced*4)",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
      );
      if (params.hasAudio) args.push("-c:a", "aac", "-b:a", "128k");
      args.push(...hlsMuxArgs(h));
    }
    await ffmpeg(args);
  }

  const renditions: HlsRendition[] = [];
  for (const h of heights) {
    const dims = copyHeights.includes(h)
      ? { width: params.sourceWidth, height: params.sourceHeight }
      : fitDimensions(params.sourceWidth, params.sourceHeight, h);
    renditions.push({
      height: dims.height,
      width: dims.width,
      bandwidth:
        (await measuredBandwidth(params.outDir, h)) ??
        BANDWIDTH_BY_HEIGHT[h] ??
        Math.round(h * 5000),
      playlist: `${h}p.m3u8`,
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
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    // CRF 18: the edit re-render becomes the new playback mezzanine that
    // every future edit/ladder derives from — keep generation loss minimal.
    "-crf",
    "18",
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
