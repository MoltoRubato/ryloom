import { eq } from "drizzle-orm";
import { z } from "zod";

import { videos } from "@ryloom/db";

import { verifyPlaybackToken } from "@/lib/playback-token";
import { r2GetText } from "@/lib/r2";
import { BUCKETS, createSignedUrl } from "@/lib/storage";
import { db } from "@/server/db";

/**
 * HLS proxy for the private processed-videos bucket.
 *
 * - Playlists (.m3u8) are fetched server-side and rewritten: nested playlist
 *   references keep routing through this proxy (with the playback token),
 *   while media segments / init fragments are replaced with presigned R2
 *   URLs so the player fetches video bytes straight from R2 — one function
 *   invocation per playlist instead of a redirect round-trip (plus a DB
 *   query) per 4-second segment.
 * - Direct segment requests (older cached playlists) still 302-redirect to a
 *   signed URL.
 */

const uuidSchema = z.string().uuid();

// Segment URLs are baked into the playlist at fetch time, so they must
// outlive the whole viewing session (VOD playlists are fetched once) —
// at least as long as the 6h playback token, plus headroom.
const SEGMENT_URL_TTL_SECONDS = 60 * 60 * 7;

function appendToken(uri: string, token: string): string {
  if (/^(https?:|data:)/i.test(uri)) return uri; // absolute URIs are left alone
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}t=${encodeURIComponent(token)}`;
}

async function rewritePlaylist(
  playlist: string,
  token: string,
  playlistDir: string,
): Promise<string> {
  // Nested playlists go back through the proxy; media URIs get presigned.
  const resolveUri = async (uri: string): Promise<string> => {
    if (/^(https?:|data:)/i.test(uri)) return uri;
    if (uri.includes("..")) return uri;
    if (uri.split("?")[0]?.endsWith(".m3u8")) return appendToken(uri, token);
    const signed = await createSignedUrl(
      BUCKETS.processed,
      `${playlistDir}/${uri}`,
      SEGMENT_URL_TTL_SECONDS,
    );
    return signed ?? appendToken(uri, token);
  };

  const lines = await Promise.all(
    playlist.split("\n").map(async (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      if (!trimmed.startsWith("#")) {
        // Variant playlist or media segment reference.
        return resolveUri(trimmed);
      }
      if (trimmed.includes('URI="')) {
        // #EXT-X-MAP / #EXT-X-MEDIA / #EXT-X-I-FRAME-STREAM-INF attributes.
        let rewritten = line;
        for (const match of line.matchAll(/URI="([^"]+)"/g)) {
          const uri = match[1];
          if (!uri) continue;
          rewritten = rewritten.replace(
            `URI="${uri}"`,
            `URI="${await resolveUri(uri)}"`,
          );
        }
        return rewritten;
      }
      return line;
    }),
  );
  return lines.join("\n");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string; path: string[] }> },
): Promise<Response> {
  const { videoId, path } = await params;
  if (!uuidSchema.safeParse(videoId).success) {
    return new Response("Not found", { status: 404 });
  }
  if (path.length === 0 || path.some((p) => p.includes("..") || p.includes("/"))) {
    return new Response("Bad request", { status: 400 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token || !verifyPlaybackToken(token, videoId)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const video = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
    columns: { id: true, workspaceId: true, status: true, hlsUrl: true },
  });
  if (!video || video.status === "deleted" || !video.hlsUrl) {
    return new Response("Not found", { status: 404 });
  }

  // Ladders live on versioned prefixes (processed/hls-<v>/) so rebuilds never
  // overwrite segments in-flight viewers are streaming — the live prefix is
  // whatever directory the current master playlist sits in.
  const hlsDir = video.hlsUrl.slice(0, video.hlsUrl.lastIndexOf("/"));
  const objectPath = `${hlsDir}/${path.join("/")}`;
  const filename = path[path.length - 1] ?? "";

  if (filename.endsWith(".m3u8")) {
    let playlist: string | null = null;
    try {
      playlist = await r2GetText(objectPath);
    } catch {
      playlist = null;
    }
    if (playlist === null) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(await rewritePlaylist(playlist, token, hlsDir), {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "private, max-age=60",
      },
    });
  }

  // Media segments / init fragments: redirect to a short-lived signed URL.
  const signedUrl = await createSignedUrl(BUCKETS.processed, objectPath, 60 * 15);
  if (!signedUrl) {
    return new Response("Not found", { status: 404 });
  }
  return Response.redirect(signedUrl, 302);
}
