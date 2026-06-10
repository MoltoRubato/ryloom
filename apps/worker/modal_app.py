"""Ryloom FFmpeg worker on Modal (serverless, free-tier friendly).

The worker runs in drain mode: a container boots, claims and processes every
queued job, then exits once the queue stays empty for DRAIN_IDLE_EXIT_SECONDS.
A built-in 1-minute schedule guarantees <=1-minute job pickup even without the
wake webhook; the `wake` endpoint starts a drain immediately after an upload.
`max_containers=1` ensures only one drain loop runs at a time (scheduled runs
and wake spawns coalesce instead of double-processing).

Usage:

    pip install modal && modal setup

    modal secret create ryloom-worker \\
        WORKER_DATABASE_URL=postgres://... \\
        SUPABASE_URL=https://YOUR-PROJECT.supabase.co \\
        SUPABASE_SERVICE_ROLE_KEY=... \\
        GEMINI_API_KEY=...            # or OPENAI_API_KEY=... (Whisper + word timestamps)
        # optional: WAKE_TOKEN=...    # shared secret required by the wake endpoint

    # from the repo root:
    modal deploy apps/worker/modal_app.py

Then copy the printed `wake` endpoint URL into Vercel as WORKER_WAKE_URL
(and WORKER_WAKE_TOKEN if you set WAKE_TOKEN).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import modal

# modal_app.py lives in apps/worker/ — the build needs the monorepo root.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

IGNORE_PATTERNS = ["**/node_modules", "**/dist", "**/.next"]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "ca-certificates", "curl")
    .pip_install("fastapi[standard]")  # required for the wake web endpoint
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g pnpm@11.5.2",
    )
    # The worker's monorepo subset (workspace manifests + the two packages).
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

app = modal.App("ryloom-worker")

with image.imports():
    from fastapi import HTTPException, Request


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("ryloom-worker")],
    timeout=3600,
    cpu=2.0,
    memory=4096,
    max_containers=1,
    schedule=modal.Period(minutes=1),
)
def drain() -> None:
    """Run the worker in drain mode: process all queued jobs, exit when idle."""
    env = {**os.environ, "WORKER_DRAIN": "true"}
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


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("ryloom-worker")],
    timeout=60,
)
@modal.fastapi_endpoint(method="POST")
def wake(request: Request) -> dict:
    """Webhook the web app calls after enqueuing a job — kicks off a drain.

    If WAKE_TOKEN is set in the `ryloom-worker` secret, requests must carry a
    matching `x-wake-token` header. Duplicate spawns are harmless: with
    max_containers=1 they queue behind (or coalesce into) the running drain.
    """
    expected = os.environ.get("WAKE_TOKEN")
    if expected and request.headers.get("x-wake-token") != expected:
        raise HTTPException(status_code=401, detail="invalid wake token")
    drain.spawn()  # fire and forget
    return {"ok": True}
