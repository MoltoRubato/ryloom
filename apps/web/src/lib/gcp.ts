import "server-only";

import { createSign } from "crypto";

import { env } from "@/env";

/**
 * Minimal Google Cloud auth + Cloud Run Jobs trigger — no SDK dependency.
 *
 * The web app holds a service-account key (roles/run.invoker on the worker
 * job only) and starts a job execution the moment a processing job is
 * enqueued. Access tokens are minted via the signed-JWT grant and cached for
 * their lifetime, so warm serverless instances skip the token round-trip.
 */

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export function cloudRunConfigured(): boolean {
  return Boolean(
    env.GCP_SA_KEY && env.CLOUD_RUN_PROJECT && env.CLOUD_RUN_REGION && env.CLOUD_RUN_JOB,
  );
}

function parseServiceAccountKey(): ServiceAccountKey {
  const raw = env.GCP_SA_KEY!.trim();
  // Accept the raw JSON or (more env-var friendly) its base64 encoding.
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as ServiceAccountKey;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const key = parseServiceAccountKey();
  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    b64url(
      JSON.stringify({
        iss: key.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: tokenUri,
        iat,
        exp: iat + 3600,
      }),
    );
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(key.private_key).toString("base64url")}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `GCP token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

/** Starts one execution of the worker job (Cloud Run Admin API v2 jobs.run). */
export async function triggerCloudRunJob(): Promise<void> {
  const token = await getAccessToken();
  const url =
    `https://run.googleapis.com/v2/projects/${env.CLOUD_RUN_PROJECT}` +
    `/locations/${env.CLOUD_RUN_REGION}/jobs/${env.CLOUD_RUN_JOB}:run`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      `Cloud Run jobs.run failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
}
