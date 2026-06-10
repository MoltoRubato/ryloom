# @ryloom/worker

The FFmpeg processing worker for Ryloom. A standalone Node service that polls
the `processing_jobs` table (with `FOR UPDATE SKIP LOCKED` + `LISTEN
ryloom_jobs` for instant wake-up) and runs the media pipeline:

| Job type          | What it does                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `transcode`       | Download raw recording → probe → H.264/AAC MP4 (plan-capped height) → thumbnail → GIF preview → waveform JSON → optional HLS ladder → uploads + `video_assets` + `videos` update → chains `transcribe` |
| `transcribe`      | Whisper (`whisper-1`, verbose JSON, word timestamps, 10-min chunking for >24MB audio) or Gemini (Files API + `generateContent`, segment timestamps only, 20-min chunking for >19MB audio) → `transcripts` + `transcript_segments` → VTT/SRT captions → usage rollup → chains `ai_generate` when auto-AI is on |
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
| `OPENAI_API_KEY`            | no       | —                  | Preferred AI provider (Whisper + chat). Wins when both keys are set.    |
| `GEMINI_API_KEY`            | no       | —                  | Google AI Studio key — fallback provider for transcription + AI. With neither key, AI jobs degrade gracefully. |
| `AI_MODEL`                  | no       | per provider       | `gpt-4o-mini` (openai) / `gemini-2.5-flash` (gemini).                   |
| `WORKER_CONCURRENCY`        | no       | `2`                | Parallel job slots. Size to CPU cores (FFmpeg is CPU-bound).            |
| `TMP_DIR`                   | no       | `$TMPDIR/ryloom`   | Scratch space for downloads and FFmpeg intermediates.                   |
| `WORKER_DRAIN`              | no       | `false`            | `true` → drain mode: skip LISTEN, process the queue, exit when idle (serverless). |
| `DRAIN_IDLE_EXIT_SECONDS`   | no       | `10`               | Idle seconds before a drain-mode worker exits.                          |

\* one of each fallback pair must be set.

`ffmpeg`/`ffprobe` must be on `PATH` (the Docker image installs them).

### AI providers

The worker picks one provider: **OpenAI when `OPENAI_API_KEY` is set, else
Gemini when `GEMINI_API_KEY` is set, else AI features are disabled.**

| Feature                                     | `OPENAI_API_KEY`            | `GEMINI_API_KEY`                                 |
| ------------------------------------------- | --------------------------- | ------------------------------------------------ |
| Transcription + captions (VTT/SRT)          | yes (Whisper)               | yes (Gemini audio understanding)                 |
| Word-level timestamps                       | yes                         | no (segment timestamps only)                     |
| Precise filler-word removal (`um`, `uh`, …) | yes (needs word timestamps) | no — job completes as skipped + notifies owner   |
| AI outputs (title, summary, chapters, …)    | yes                         | yes (OpenAI-compatible endpoint)                 |

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

## Deploying on Modal (free tier)

`modal_app.py` runs the worker serverlessly in **drain mode**: a container
boots, processes every queued job, and exits once the queue has been empty for
`DRAIN_IDLE_EXIT_SECONDS` — so you only pay for (or burn free-tier credit on)
actual processing time.

```bash
pip install modal && modal setup

modal secret create ryloom-worker \
  WORKER_DATABASE_URL=postgres://... \
  SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... \
  GEMINI_API_KEY=...            # or OPENAI_API_KEY=... (Whisper word timestamps)
  # optional: WAKE_TOKEN=...    # shared secret required by the wake endpoint

# from the repo root:
modal deploy apps/worker/modal_app.py
```

Then copy the printed `wake` endpoint URL into Vercel as `WORKER_WAKE_URL`
(and `WORKER_WAKE_TOKEN` if you set `WAKE_TOKEN`).

How it works:

- **`drain`** — the worker process with `WORKER_DRAIN=true`. It carries a
  built-in `modal.Period(minutes=1)` schedule, so queued jobs are picked up
  within ≤1 minute even if the wake webhook is never configured.
  `max_containers=1` guarantees only one drain loop runs at a time.
- **`wake`** — a POST endpoint that `drain.spawn()`s immediately (duplicate
  wakes coalesce/queue behind the running drain). If `WAKE_TOKEN` is set in
  the secret, requests must send a matching `x-wake-token` header.
- Retention sweeps self-enqueue at most once per 12h across drain runs.

See the [AI providers](#ai-providers) table above for what `GEMINI_API_KEY`
vs `OPENAI_API_KEY` enables — only Whisper (OpenAI) produces the word-level
timestamps that precise filler-word removal needs.

Graceful shutdown: on `SIGTERM` the worker stops claiming jobs, finishes
in-flight work, and exits — give it a generous kill timeout (Fly is configured
with 300s).
