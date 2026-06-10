import { eq } from "drizzle-orm";
import { z } from "zod";

import { videos } from "@ryloom/db";

import { BUCKETS, publicUrl, storagePaths } from "@/lib/storage";
import { db } from "@/server/db";

/**
 * Serves captions from the public captions bucket via a stable app URL:
 *   /api/captions/{videoId}?lang=en&fmt=vtt
 */

const uuidSchema = z.string().uuid();
const langSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i)
  .transform((v) => v.toLowerCase());
const fmtSchema = z.enum(["vtt", "srt"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> },
): Promise<Response> {
  const { videoId } = await params;
  if (!uuidSchema.safeParse(videoId).success) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const lang = langSchema.safeParse(url.searchParams.get("lang") ?? "en");
  const fmt = fmtSchema.safeParse(url.searchParams.get("fmt") ?? "vtt");
  if (!lang.success || !fmt.success) {
    return new Response("Bad request", { status: 400 });
  }

  const video = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
    columns: { id: true, workspaceId: true, status: true },
  });
  if (!video || video.status === "deleted") {
    return new Response("Not found", { status: 404 });
  }

  const captionsUrl = publicUrl(
    BUCKETS.captions,
    storagePaths.captions(video.workspaceId, video.id, lang.data, fmt.data),
  );
  return Response.redirect(captionsUrl, 302);
}
