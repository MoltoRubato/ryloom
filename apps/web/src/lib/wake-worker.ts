import "server-only";

import { after } from "next/server";

import { env } from "@/env";
import { cloudRunConfigured, triggerCloudRunJob } from "@/lib/gcp";

/**
 * Fire-and-forget wake of the scale-to-zero worker after a processing job is
 * enqueued. Never throws and never blocks the caller; the scheduled backstop
 * (/api/worker-backstop) is the fallback.
 *
 * Two backends, by configuration:
 * - Cloud Run Jobs (GCP_SA_KEY + CLOUD_RUN_*): starts a job execution.
 * - Plain webhook (WORKER_WAKE_URL): POSTs it — e.g. the Modal wake endpoint.
 *
 * Wrapped in next/server `after()` so the call survives the response being
 * sent — on Vercel a bare `void fetch()` can be dropped when the function
 * suspends after responding.
 */

// Per-instance debounce: bursts of uploads coalesce into one execution.
// Overlapping executions are harmless anyway (FOR UPDATE SKIP LOCKED), this
// just avoids paying Cloud Run's 1-minute-minimum twice for one burst.
const WAKE_DEBOUNCE_MS = 10_000;
let lastWakeAt = 0;

export function wakeWorker(): void {
  const useCloudRun = cloudRunConfigured();
  if (!useCloudRun && !env.WORKER_WAKE_URL) return;
  if (Date.now() - lastWakeAt < WAKE_DEBOUNCE_MS) return;
  lastWakeAt = Date.now();

  const ping = async (): Promise<void> => {
    if (useCloudRun) {
      await triggerCloudRunJob().catch(() => undefined);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    await fetch(env.WORKER_WAKE_URL!, {
      method: "POST",
      signal: controller.signal,
      headers: env.WORKER_WAKE_TOKEN
        ? { "x-wake-token": env.WORKER_WAKE_TOKEN }
        : undefined,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  };
  try {
    after(ping());
  } catch {
    // Outside a request scope (scripts/tests) — fall back to best-effort.
    void ping();
  }
}
