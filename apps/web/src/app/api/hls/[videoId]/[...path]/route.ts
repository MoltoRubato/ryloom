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
 * - Playlists (.m3u8) are fetched server-side and rewritten so every segment /
 *   media URI carries the playback token (`?t=...`) back through this route.
 * - Segments (.ts/.m4s/.mp4/.aac) 302-redirect to short-lived signed URLs so
 *   video bytes never flow through Next.js.
 */

const uuidSchema = z.string().uuid();

function appendToken(uri: string, token: string): string {
  if (/^(https?:|data:)/i.test(uri)) return uri; // absolute URIs are left alone
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}t=${encodeURIComponent(token)}`;
}

function rewritePlaylist(playlist: string, token: string): string {
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      if (!trimmed.startsWith("#")) {
        // Variant playlist or media segment reference.
        return appendToken(trimmed, token);
      }
      if (trimmed.includes('URI="')) {
        // #EXT-X-MAP / #EXT-X-MEDIA / #EXT-X-I-FRAME-STREAM-INF attributes.
        return line.replace(
          /URI="([^"]+)"/g,
          (_match, uri: string) => `URI="${appendToken(uri, token)}"`,
        );
      }
      return line;
    })
    .join("\n");
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
    columns: { id: true, workspaceId: true, status: true },
  });
  if (!video || video.status === "deleted") {
    return new Response("Not found", { status: 404 });
  }

  const objectPath = `workspaces/${video.workspaceId}/videos/${video.id}/processed/hls/${path.join("/")}`;
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
    return new Response(rewritePlaylist(playlist, token), {
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
