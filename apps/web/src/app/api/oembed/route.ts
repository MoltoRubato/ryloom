import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import { resolvePublicSharedVideo } from "@/lib/public-video";

/**
 * oEmbed provider for share links, so chat apps and editors that speak
 * oEmbed (Slack, Notion, Medium, …) can render an inline player:
 *   /api/oembed?url=https://…/share/<token>&format=json
 *
 * Discovered via the <link rel="alternate" type="application/json+oembed">
 * tag emitted by the share page.
 */
export const dynamic = "force-dynamic";

const TOKEN_RE = /\/(?:share|embed)\/([A-Za-z0-9_-]{6,64})/;

function clampDim(value: string | null, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.round(n), 4096);
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const format = search.get("format");
  if (format && format !== "json") {
    return new NextResponse("Only json is supported", { status: 501 });
  }

  const target = search.get("url") ?? "";
  const token = TOKEN_RE.exec(target)?.[1];
  if (!token) return new NextResponse("Unrecognized url", { status: 404 });

  const resolved = await resolvePublicSharedVideo(token);
  if (!resolved || !resolved.allowEmbed) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { video } = resolved;

  // Fit the video's aspect ratio inside the consumer's max box (16:9 default).
  const srcWidth = video.width ?? 1280;
  const srcHeight = video.height ?? 720;
  const maxWidth = clampDim(search.get("maxwidth"), 800);
  const maxHeight = clampDim(search.get("maxheight"), 450);
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight, 1);
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const embedUrl = `${appUrl}/embed/${token}`;
  const thumbnail = video.customThumbnailUrl ?? video.thumbnailUrl;

  return NextResponse.json(
    {
      version: "1.0",
      type: "video",
      provider_name: "Ryloom",
      provider_url: appUrl,
      title: video.title,
      html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" allowfullscreen title="${video.title.replace(/"/g, "&quot;")}"></iframe>`,
      width,
      height,
      ...(thumbnail
        ? {
            thumbnail_url: thumbnail,
            thumbnail_width: srcWidth,
            thumbnail_height: srcHeight,
          }
        : {}),
      ...(video.durationMs ? { duration: Math.round(video.durationMs / 1000) } : {}),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
