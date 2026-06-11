import { type Metadata } from "next";
import { TRPCError } from "@trpc/server";

import { ShareErrorCard } from "@/components/watch/error-card";
import { SharePageClient } from "@/components/watch/share-page-client";
import { env } from "@/env";
import { resolvePublicSharedVideo } from "@/lib/public-video";
import { api, HydrateClient } from "@/trpc/server";

// Playback URLs are signed per-request — never cache this page.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

function shareErrorMessage(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "NOT_FOUND") {
      return "This video doesn't exist or has been removed by its owner.";
    }
    return error.message || "You don't have access to this video.";
  }
  return "Something went wrong while loading this video. Please try again.";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const pageUrl = `${appUrl}/share/${token}`;

  // Public links get the full unfurl treatment: og:video + twitter:player so
  // the video plays inline in Slack/Discord/iMessage, plus oEmbed discovery.
  try {
    const resolved = await resolvePublicSharedVideo(token);
    if (resolved && resolved.video.status === "ready") {
      const { video } = resolved;
      const title = video.title;
      const description =
        video.description ?? "Watch this video on Ryloom — async video messaging for work.";
      const thumbnail = video.customThumbnailUrl ?? video.thumbnailUrl;
      const width = video.width ?? 1280;
      const height = video.height ?? 720;
      const mp4Url = `${appUrl}/api/playback/${token}/video.mp4`;
      const embedUrl = `${appUrl}/embed/${token}`;

      return {
        title,
        description,
        alternates: {
          canonical: pageUrl,
          types: {
            "application/json+oembed": [
              {
                url: `${appUrl}/api/oembed?url=${encodeURIComponent(pageUrl)}&format=json`,
                title,
              },
            ],
          },
        },
        openGraph: {
          type: "video.other",
          url: pageUrl,
          siteName: "Ryloom",
          title,
          description,
          images: thumbnail ? [{ url: thumbnail, width, height }] : undefined,
          // Order matters: Slack (and Facebook) only render an inline player
          // from a text/html og:video (an embeddable iframe) and take the
          // first entry they understand, while Discord scans the list for the
          // raw video/mp4. The iframe must come first or Slack falls back to
          // a static image unfurl.
          videos: [
            ...(resolved.allowEmbed
              ? [{ url: embedUrl, secureUrl: embedUrl, type: "text/html", width, height }]
              : []),
            { url: mp4Url, secureUrl: mp4Url, type: "video/mp4", width, height },
          ],
        },
        twitter: resolved.allowEmbed
          ? {
              card: "player",
              title,
              description,
              images: thumbnail ? [thumbnail] : undefined,
              players: [{ playerUrl: embedUrl, streamUrl: mp4Url, width, height }],
            }
          : undefined,
      };
    }
  } catch {
    /* fall through to the minimal metadata below */
  }

  try {
    const data = await api.video.getByShareToken({ token });
    return { title: data.state === "ok" ? data.video.title : data.title };
  } catch {
    return { title: "Watch video" };
  }
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;

  let initialData;
  try {
    initialData = await api.video.getByShareToken({ token });
  } catch (error) {
    return <ShareErrorCard message={shareErrorMessage(error)} />;
  }

  return (
    <HydrateClient>
      <SharePageClient token={token} initialData={initialData} />
    </HydrateClient>
  );
}
