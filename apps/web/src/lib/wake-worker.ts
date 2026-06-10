import "server-only";

import { env } from "@/env";

/**
 * Fire-and-forget ping to a scale-to-zero worker (e.g. the Modal wake
 * endpoint) after a processing job is enqueued. Never throws and never
 * blocks the caller; the worker's polling schedule is the fallback.
 */
export function wakeWorker(): void {
  if (!env.WORKER_WAKE_URL) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  void fetch(env.WORKER_WAKE_URL, {
    method: "POST",
    signal: controller.signal,
    headers: env.WORKER_WAKE_TOKEN
      ? { "x-wake-token": env.WORKER_WAKE_TOKEN }
      : undefined,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
