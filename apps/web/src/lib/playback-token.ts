import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { env } from "@/env";

/**
 * Short-lived HMAC tokens that authorize HLS playlist/segment access for
 * private videos via /api/hls/[videoId]/[...path]?t=<token>.
 * Format: base64url(videoId.exp).base64url(hmac)
 */

const SECRET = env.SUPABASE_SERVICE_ROLE_KEY;

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createPlaybackToken(videoId: string, ttlSeconds = 6 * 60 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${videoId}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyPlaybackToken(token: string, videoId: string): boolean {
  const [payloadB64, mac] = token.split(".");
  if (!payloadB64 || !mac) return false;
  const payload = Buffer.from(payloadB64, "base64url").toString();
  const [tokenVideoId, expStr] = payload.split(".");
  if (tokenVideoId !== videoId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
