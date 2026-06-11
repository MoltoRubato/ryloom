"""Ryloom FFmpeg worker on Modal (serverless, free-tier friendly).

Three functions:

- ``drain``  — the heavy worker (2 CPU / 4GB, Node + FFmpeg). Runs in drain
  mode: claims and processes every queued job, exits once the queue stays
  empty for a few seconds. ``max_containers=1`` ensures only one drain loop
  runs at a time (wake spawns and scout spawns coalesce instead of
  double-processing).
- ``scout``  — a tiny (0.125 CPU / 256MB) scheduled function that runs every
  2 minutes, does one SQL query, and spawns ``drain`` only when there is
  work. This keeps idle cost near zero — scheduling the heavy container
  directly would burn the entire $30/month free credit on empty polls.
- ``wake``   — webhook the web app calls right after enqueuing a job, for
  instant pickup (the scout is only the fallback).

Usage:

    pip install modal && modal setup

    modal secret create ryloom-worker \\
        WORKER_DATABASE_URL=postgres://...   # SESSION POOLER string (port 5432,
                                             # *.pooler.supabase.com — the direct
                                             # db.*.supabase.co host is IPv6-only
                                             # on Supabase Free and unreachable
                                             # from Modal) \\
        SUPABASE_URL=https://YOUR-PROJECT.supabase.co \\
        SUPABASE_SERVICE_ROLE_KEY=... \\
        R2_ACCOUNT_ID=... \\
        R2_ACCESS_KEY_ID=... \\
        R2_SECRET_ACCESS_KEY=... \\
        R2_BUCKET=ryloom-media \\
        WAKE_TOKEN=...                       # shared secret for the wake endpoint \\
        GEMINI_API_KEY=...                   # or OPENAI_API_KEY=... (Whisper)

    # from the repo root:
    modal deploy apps/worker/modal_app.py

Then copy the printed `wake` endpoint URL into Vercel as WORKER_WAKE_URL
(and your WAKE_TOKEN value as WORKER_WAKE_TOKEN).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import modal

# modal_app.py lives in apps/worker/ — the build needs the monorepo root.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

IGNORE_PATTERNS = ["**/node_modules", "**/dist", "**/.next", "**/__pycache__"]

# Heavy image: Node 22 + FFmpeg + the worker's monorepo subset.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "ca-certificates", "curl")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g pnpm@11.5.2",
    )
    .add_local_file(REPO_ROOT / "package.json", "/app/package.json", copy=True)
    .add_local_file(REPO_ROOT / "pnpm-workspace.yaml", "/app/pnpm-workspace.yaml", copy=True)
    .add_local_file(REPO_ROOT / "pnpm-lock.yaml", "/app/pnpm-lock.yaml", copy=True)
    .add_local_dir(
        REPO_ROOT / "packages" / "db",
        "/app/packages/db",
        copy=True,
        ignore=IGNORE_PATTERNS,
    )
    .add_local_dir(
        REPO_ROOT / "apps" / "worker",
        "/app/apps/worker",
        copy=True,
        ignore=IGNORE_PATTERNS,
    )
    .run_commands("cd /app && pnpm install --filter '@ryloom/worker...' --no-frozen-lockfile")
)

# Lite image for the scout + wake endpoint: one SQL query / one spawn call.
lite_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]", "psycopg[binary]"
)

app = modal.App("ryloom-worker")

with lite_image.imports():
    import psycopg
    from fastapi import HTTPException, Request


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("ryloom-worker")],
    # Generous hard cap (drain exits when idle, so a long timeout costs
    # nothing) — the worker stops claiming new jobs 20 min before it via
    # DRAIN_MAX_RUNTIME_SECONDS so in-flight encodes finish cleanly.
    timeout=6 * 3600,
    cpu=2.0,
    memory=4096,
    max_containers=1,
)
def drain() -> None:
    """Run the worker in drain mode: process all queued jobs, exit when idle."""
    env = {**os.environ, "WORKER_DRAIN": "true"}
    env.setdefault("DRAIN_IDLE_EXIT_SECONDS", "5")
    env.setdefault("DRAIN_MAX_RUNTIME_SECONDS", str(6 * 3600 - 1200))
    proc = subprocess.Popen(
        ["pnpm", "--filter", "@ryloom/worker", "start"],
        cwd="/app",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="", flush=True)
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"worker exited with code {code}")


# Matches STALE_LOCK_MINUTES in apps/worker/src/queue.ts — the scout must also
# wake the drain for expired 'running' jobs so they get reclaimed.
_SCOUT_QUERY = """
    SELECT 1 FROM processing_jobs
    WHERE (status = 'queued' AND scheduled_at <= now())
       OR (status = 'running' AND locked_at < now() - interval '15 minutes')
    LIMIT 1
"""


@app.function(
    image=lite_image,
    secrets=[modal.Secret.from_name("ryloom-worker")],
    timeout=60,
    cpu=0.125,
    memory=256,
    schedule=modal.Period(minutes=2),
)
def scout() -> None:
    """Cheap scheduled check: spawn the heavy drain only when work exists."""
    with psycopg.connect(os.environ["WORKER_DATABASE_URL"], connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute(_SCOUT_QUERY)
            has_work = cur.fetchone() is not None
    if has_work:
        print("scout: queue has work — spawning drain")
        drain.spawn()
    else:
        print("scout: queue empty")


@app.function(
    image=lite_image,
    secrets=[modal.Secret.from_name("ryloom-worker")],
    timeout=60,
    cpu=0.125,
    memory=256,
)
@modal.fastapi_endpoint(method="POST")
def wake(request: Request) -> dict:
    """Webhook the web app calls after enqueuing a job — kicks off a drain.

    If WAKE_TOKEN is set in the `ryloom-worker` secret (recommended), requests
    must carry a matching `x-wake-token` header. Duplicate spawns are cheap:
    with max_containers=1 they queue behind the running drain and exit within
    seconds once the queue is empty.
    """
    expected = os.environ.get("WAKE_TOKEN")
    if expected and request.headers.get("x-wake-token") != expected:
        raise HTTPException(status_code=401, detail="invalid wake token")
    drain.spawn()  # fire and forget
    return {"ok": True}
