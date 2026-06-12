import { createHmac, timingSafeEqual } from "node:crypto";

import { after, type NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import { resolvePublicSharedVideo } from "@/lib/public-video";

/**
 * Slack Events API endpoint for inline video unfurls.
 *
 * Slack never renders a playable video from og:video / twitter:player tags
 * on arbitrary domains — only registered apps get an inline player. This
 * endpoint receives `link_shared` events for our domain and answers with
 * `chat.unfurl` + a Block Kit video block (the Loom-in-Slack experience).
 *
 * Setup: create the app from docs/slack-app-manifest.yaml, install it, and
 * set SLACK_SIGNING_SECRET + SLACK_BOT_TOKEN. Without those env vars this
 * route refuses requests.
 */

export const dynamic = "force-dynamic";

const TOKEN_RE = /\/(?:share|embed)\/([A-Za-z0-9_-]{6,64})/;
const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

function verifySlackSignature(req: NextRequest, rawBody: string): boolean {
  const secret = env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) return false;

  const expected = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

type LinkSharedEvent = {
  type: "link_shared";
  channel?: string;
  message_ts?: string;
  unfurl_id?: string;
  source?: string;
  links?: { url?: string; domain?: string }[];
};

/** One Block Kit video block per shared link that resolves to a public video. */
async function buildUnfurls(
  links: { url?: string }[],
): Promise<Record<string, unknown>> {
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const unfurls: Record<string, unknown> = {};

  for (const link of links.slice(0, 10)) {
    const url = link.url;
    const token = url ? TOKEN_RE.exec(url)?.[1] : undefined;
    if (!url || !token || url in unfurls) continue;

    const resolved = await resolvePublicSharedVideo(token).catch(() => null);
    if (!resolved || !resolved.allowEmbed || resolved.video.status !== "ready") {
      continue;
    }
    const { video } = resolved;
    // thumbnail_url is required by the video block; without one, let Slack
    // fall back to its own meta-tag card.
    const thumbnail = video.customThumbnailUrl ?? video.thumbnailUrl;
    if (!thumbnail) continue;

    const title = video.title.slice(0, 199);
    unfurls[url] = {
      blocks: [
        {
          type: "video",
          title: { type: "plain_text", text: title },
          title_url: `${appUrl}/share/${token}`,
          description: {
            type: "plain_text",
            text: video.description?.slice(0, 199) ?? "Watch on Ryloom",
          },
          video_url: `${appUrl}/embed/${token}`,
          thumbnail_url: thumbnail,
          alt_text: title,
          provider_name: "Ryloom",
        },
      ],
    };
  }
  return unfurls;
}

async function sendUnfurl(event: LinkSharedEvent): Promise<void> {
  const unfurls = await buildUnfurls(event.links ?? []);
  if (Object.keys(unfurls).length === 0) return;

  // Composer previews carry source/unfurl_id; posted messages carry
  // channel/message_ts. chat.unfurl wants whichever pair the event has.
  const target =
    event.unfurl_id && event.source
      ? { unfurl_id: event.unfurl_id, source: event.source }
      : { channel: event.channel, ts: event.message_ts };

  const res = await fetch("https://slack.com/api/chat.unfurl", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ ...target, unfurls }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!body?.ok) {
    console.error(`[slack-unfurl] chat.unfurl failed: ${body?.error ?? res.status}`);
  }
}

export async function POST(req: NextRequest) {
  if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) {
    return new NextResponse("Slack unfurls not configured", { status: 404 });
  }

  const rawBody = await req.text();
  if (!verifySlackSignature(req, rawBody)) {
    return new NextResponse("Bad signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new NextResponse("Bad payload", { status: 400 });
  }

  // One-time endpoint ownership handshake when the app is configured.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    const event = payload.event as LinkSharedEvent | undefined;
    if (event?.type === "link_shared") {
      // Slack expects a 2xx within 3 seconds; do the unfurl after the ack.
      after(async () => {
        try {
          await sendUnfurl(event);
        } catch (error) {
          console.error("[slack-unfurl]", error);
        }
      });
    }
  }

  return new NextResponse("ok", { status: 200 });
}
