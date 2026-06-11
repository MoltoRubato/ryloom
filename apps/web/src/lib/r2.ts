import "server-only";

import { createHash } from "crypto";

import { AwsClient } from "aws4fetch";

import { env } from "@/env";

/**
 * Cloudflare R2 client (S3 API) for the video media plane.
 *
 * Raw recordings and processed MP4/HLS renditions live in a single private R2
 * bucket (zero egress fees — the dominant cost of serving video). Small public
 * assets (thumbnails, captions, avatars, branding) stay in Supabase Storage.
 *
 * Uploads from the browser/desktop use S3 multipart with presigned part URLs
 * issued by `recording.startUpload`; playback uses presigned GETs.
 */

let client: AwsClient | null = null;

function r2(): AwsClient {
  client ??= new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  return client;
}

function objectUrl(key: string): string {
  // Path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodedKey}`;
}

/** Presigned GET URL (playback, worker downloads). */
export async function r2SignedGetUrl(key: string, ttlSeconds: number): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
  const signed = await r2().sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * HEADs an object. Multipart objects only materialize when the upload is
 * completed, so existence doubles as proof that every part landed.
 */
export async function r2ObjectExists(key: string): Promise<boolean> {
  const res = await r2().fetch(objectUrl(key), { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`R2 HEAD ${key} failed (${res.status})`);
  }
  return true;
}

/** Fetches a small text object (HLS playlists). Returns null when missing. */
export async function r2GetText(key: string): Promise<string | null> {
  const res = await r2().fetch(objectUrl(key));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 GET ${key} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.text();
}

export async function r2CreateMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const res = await r2().fetch(`${objectUrl(key)}?uploads`, {
    method: "POST",
    headers: { "content-type": contentType },
  });
  if (!res.ok) {
    throw new Error(
      `R2 CreateMultipartUpload failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const body = await res.text();
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(body)?.[1];
  if (!uploadId) throw new Error("R2 CreateMultipartUpload returned no UploadId");
  return uploadId;
}

/** Presigned URL the browser PUTs one part to. */
export async function r2SignUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  ttlSeconds: number,
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
  const signed = await r2().sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function r2CompleteMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<void> {
  const xml = [
    "<CompleteMultipartUpload>",
    ...[...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => {
        const etag = p.etag.replace(/"/g, "");
        return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${etag}"</ETag></Part>`;
      }),
    "</CompleteMultipartUpload>",
  ].join("");
  const url = new URL(objectUrl(key));
  url.searchParams.set("uploadId", uploadId);
  const res = await r2().fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: xml,
  });
  const body = await res.text();
  // S3 can return 200 with an embedded <Error> — treat both as failure.
  if (!res.ok || body.includes("<Error>")) {
    throw new Error(`R2 CompleteMultipartUpload failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

export async function r2AbortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("uploadId", uploadId);
  const res = await r2().fetch(url.toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 AbortMultipartUpload failed (${res.status})`);
  }
}

/** Decodes the XML entities ListObjectsV2 uses in <Key> values. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Deletes every object under a prefix (ListObjectsV2 is recursive). */
export async function r2DeletePrefix(prefix: string): Promise<void> {
  const bucketUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  let continuationToken: string | null = null;
  do {
    const listUrl = new URL(bucketUrl);
    listUrl.searchParams.set("list-type", "2");
    listUrl.searchParams.set("prefix", prefix.endsWith("/") ? prefix : `${prefix}/`);
    listUrl.searchParams.set("max-keys", "1000");
    if (continuationToken) listUrl.searchParams.set("continuation-token", continuationToken);

    const listRes = await r2().fetch(listUrl.toString());
    if (!listRes.ok) {
      throw new Error(`R2 ListObjectsV2 failed (${listRes.status})`);
    }
    const listBody = await listRes.text();
    // Keys arrive XML-entity-encoded — decode before re-encoding for Delete.
    const keys = [...listBody.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => unescapeXml(m[1]!));
    continuationToken =
      /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(listBody)?.[1] ?? null;
    if (keys.length === 0) break;

    const deleteXml = `<Delete>${keys
      .map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`)
      .join("")}<Quiet>true</Quiet></Delete>`;
    const md5 = createHash("md5").update(deleteXml).digest("base64");
    const delRes = await r2().fetch(`${bucketUrl}?delete`, {
      method: "POST",
      headers: { "content-type": "application/xml", "content-md5": md5 },
      body: deleteXml,
    });
    const delBody = await delRes.text();
    // Quiet mode returns 200 with per-key <Error> entries on partial failure.
    if (!delRes.ok || delBody.includes("<Error>")) {
      throw new Error(`R2 DeleteObjects failed (${delRes.status}): ${delBody.slice(0, 300)}`);
    }
  } while (continuationToken);
}
