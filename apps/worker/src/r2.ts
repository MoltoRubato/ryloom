import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { AwsClient } from "aws4fetch";

import { env } from "./env";

/**
 * Cloudflare R2 (S3 API) — the video media plane. Raw recordings and
 * processed MP4/HLS renditions live here; small public assets stay in
 * Supabase Storage (see storage.ts for the routing).
 *
 * Uploads are chunked (64MB) so memory stays bounded no matter how large the
 * video is — never reads a whole media file into memory.
 */

const PART_SIZE = 64 * 1024 * 1024;
/** Files at or below this size upload as one PUT (1 op instead of 3). */
const SINGLE_PUT_MAX = 64 * 1024 * 1024;

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
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodedKey}`;
}

/** Streams an R2 object to a local file. */
export async function r2DownloadToFile(key: string, destFile: string): Promise<void> {
  const res = await r2().fetch(objectUrl(key));
  if (!res.ok || !res.body) {
    throw new Error(`R2 download failed (${key}): HTTP ${res.status}`);
  }
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    createWriteStream(destFile),
  );
}

async function putBuffer(
  url: string,
  body: Uint8Array,
  contentType?: string,
): Promise<Response> {
  const res = await r2().fetch(url, {
    method: "PUT",
    headers: contentType ? { "content-type": contentType } : undefined,
    body,
  });
  if (!res.ok) {
    throw new Error(`R2 PUT failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/**
 * Uploads a local file to R2. Small files go up in one PUT; larger files use
 * multipart with one 64MB buffer in memory at a time.
 */
export async function r2UploadFile(
  key: string,
  localFile: string,
  contentType: string,
): Promise<void> {
  const stat = await fs.stat(localFile);

  if (stat.size <= SINGLE_PUT_MAX) {
    const body = await fs.readFile(localFile);
    await putBuffer(objectUrl(key), body, contentType);
    return;
  }

  // Multipart: create → PUT parts sequentially → complete (abort on failure).
  const createRes = await r2().fetch(`${objectUrl(key)}?uploads`, {
    method: "POST",
    headers: { "content-type": contentType },
  });
  if (!createRes.ok) {
    throw new Error(`R2 CreateMultipartUpload failed (${key}): HTTP ${createRes.status}`);
  }
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await createRes.text())?.[1];
  if (!uploadId) throw new Error("R2 CreateMultipartUpload returned no UploadId");

  const handle = await fs.open(localFile, "r");
  const etags: string[] = [];
  try {
    const buffer = Buffer.alloc(PART_SIZE);
    let offset = 0;
    let partNumber = 1;
    while (offset < stat.size) {
      // Fill the buffer completely (fs.read may return short) — R2 requires
      // every part except the last to be exactly the same size.
      let filled = 0;
      while (filled < PART_SIZE) {
        const { bytesRead } = await handle.read(buffer, filled, PART_SIZE - filled, offset + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled === 0) break;
      const url = new URL(objectUrl(key));
      url.searchParams.set("partNumber", String(partNumber));
      url.searchParams.set("uploadId", uploadId);
      const res = await putBuffer(url.toString(), buffer.subarray(0, filled));
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("R2 UploadPart returned no ETag");
      etags.push(etag);
      offset += filled;
      partNumber += 1;
    }

    const xml = `<CompleteMultipartUpload>${etags
      .map(
        (etag, i) =>
          `<Part><PartNumber>${i + 1}</PartNumber><ETag>"${etag.replace(/"/g, "")}"</ETag></Part>`,
      )
      .join("")}</CompleteMultipartUpload>`;
    const completeUrl = new URL(objectUrl(key));
    completeUrl.searchParams.set("uploadId", uploadId);
    const completeRes = await r2().fetch(completeUrl.toString(), {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: xml,
    });
    const completeBody = await completeRes.text();
    if (!completeRes.ok || completeBody.includes("<Error>")) {
      throw new Error(
        `R2 CompleteMultipartUpload failed (${key}): ${completeBody.slice(0, 200)}`,
      );
    }
  } catch (error) {
    const abortUrl = new URL(objectUrl(key));
    abortUrl.searchParams.set("uploadId", uploadId);
    await r2()
      .fetch(abortUrl.toString(), { method: "DELETE" })
      .catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
}
