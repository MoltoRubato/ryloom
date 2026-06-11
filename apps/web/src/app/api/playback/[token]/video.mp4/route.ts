import { type NextRequest, NextResponse } from "next/server";

import { resolvePublicSharedVideo } from "@/lib/public-video";
import { BUCKETS, createSignedUrl } from "@/lib/storage";

/**
 * Stable, public MP4 URL for a shared video:
 *   /api/playback/<shareToken>/video.mp4  →  302 to a freshly signed R2 URL
 *
 * This is what og:video / twitter:player:stream point at, so Slack, iMessage,
 * Discord etc. can fetch and play the video without auth and without us
 * baking short-lived signed URLs into meta tags. Only effectively-public
 * links resolve — everything else 404s.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const resolved = await resolvePublicSharedVideo(token);
  if (!resolved || resolved.video.status !== "ready" || !resolved.video.playbackUrl) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = await createSignedUrl(BUCKETS.processed, resolved.video.playbackUrl, 60 * 60);
  if (!url) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
