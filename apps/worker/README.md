# @ryloom/worker

The FFmpeg processing worker for Ryloom. A standalone Node service that polls
the `processing_jobs` table (with `FOR UPDATE SKIP LOCKED` + `LISTEN
ryloom_jobs` for instant wake-up) and runs the media pipeline:

| Job type          | What it does                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `transcode`       | Download raw recording → probe → H.264/AAC MP4 (plan-capped height) → thumbnail → GIF preview → waveform JSON → optional HLS ladder → uploads + `video_assets` + `videos` update → chains `transcribe` |
| `transcribe`      | Whisper (`whisper-1`, verbose JSON, word timestamps, 10-min chunking for >24MB audio) → `transcripts` + `transcript_segments` → VTT/SRT captions → usage rollup → chains `ai_generate` when auto-AI is on |
| `ai_generate`     | Title / summary / chapters / action items / bug report / SOP / email / Slack / PR / Jira / Linear / FAQ / meeting notes / recap email / doc from the transcript |
| `trim`            | Re-render the playback MP4 keeping only the requested ranges (backs up the previous MP4 as `original_backup`)   |
| `silence_removal` | `silencedetect`-driven automatic cut of silent passages with padding                                            |
| `filler_removal`  | Cuts filler words ("um", "uh", …, "you know") using word-level transcript timestamps                            |
| `stitch`          | Normalizes (1080p30/AAC) and concatenates source videos into a new video, then runs the full ingest pipeline    |
| `retention_sweep` | Archives ready videos older than each workspace's retention policy (skips legal holds); self-enqueued every 12h |

Failed jobs retry with linear backoff (`attempts × 60s`) up to `max_attempts`,
then the video is flagged `failed` and the owner gets a `video_failed`
notification.

## Environment

Copy the repo root `.env.example` to `apps/worker/.env`.

| Variable                    | Required | Default            | Notes                                                                  |
| --------------------------- | -------- | ------------------ | ---------------------------------------------------------------------- |
| `WORKER_DATABASE_URL`       | yes\*    | —                  | Direct Postgres connection (port 5432). Falls back to `DATABASE_URL`.  |
| `DATABASE_URL`              | yes\*    | —                  | Used when `WORKER_DATABASE_URL` is not set.                             |
| `SUPABASE_URL`              | yes\*    | —                  | Falls back to `NEXT_PUBLIC_SUPABASE_URL`.                               |
| `SUPABASE_SERVICE_ROLE_KEY` | yes      | —                  | Storage + DB writes bypass RLS.                                         |
| `OPENAI_API_KEY`            | no       | —                  | Empty disables transcription + AI generation (jobs degrade gracefully). |
| `AI_MODEL`                  | no       | `gpt-4o-mini`      | Any chat-completions model id.                                          |
| `WORKER_CONCURRENCY`        | no       | `2`                | Parallel job slots. Size to CPU cores (FFmpeg is CPU-bound).            |
| `TMP_DIR`                   | no       | `$TMPDIR/ryloom`   | Scratch space for downloads and FFmpeg intermediates.                   |

\* one of each fallback pair must be set.

`ffmpeg`/`ffprobe` must be on `PATH` (the Docker image installs them).

## Run locally

```bash
# from the repo root
pnpm install
pnpm --filter @ryloom/worker dev     # tsx watch
pnpm --filter @ryloom/worker start   # one-off
pnpm --filter @ryloom/worker typecheck
```

## Docker

The build context is the **monorepo root** (the image needs `packages/db`):

```bash
docker build -f apps/worker/Dockerfile -t ryloom-worker .
docker run --env-file apps/worker/.env ryloom-worker
```

## Deploy

**Fly.io** (no HTTP service — pure background worker):

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
fly secrets set WORKER_DATABASE_URL=... SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... --config apps/worker/fly.toml
fly deploy . --config apps/worker/fly.toml
```

**Railway**: point the service at this repo, set the root directory to the repo
root and the config path to `apps/worker/railway.json`, then add the env vars
above. The Dockerfile path is already configured.

Graceful shutdown: on `SIGTERM` the worker stops claiming jobs, finishes
in-flight work, and exits — give it a generous kill timeout (Fly is configured
with 300s).
