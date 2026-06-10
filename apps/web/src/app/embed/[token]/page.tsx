import { type Metadata } from "next";
import { TRPCError } from "@trpc/server";

import { EmbedClient } from "@/components/watch/embed-client";
import { ShareErrorCard } from "@/components/watch/error-card";
import { api, HydrateClient } from "@/trpc/server";

// Signed playback URLs + per-viewer gates — never cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Embedded video",
  robots: { index: false },
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function embedErrorMessage(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "NOT_FOUND") {
      return "This video doesn't exist or has been removed by its owner.";
    }
    return error.message || "You don't have access to this video.";
  }
  return "Something went wrong while loading this video.";
}

export default async function EmbedPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const search = await searchParams;
  const titleParam = Array.isArray(search.title) ? search.title[0] : search.title;
  const showTitle = titleParam !== "0";

  let initialData;
  try {
    initialData = await api.video.getByShareToken({ token, embed: true });
  } catch (error) {
    return <ShareErrorCard dark message={embedErrorMessage(error)} />;
  }

  return (
    <HydrateClient>
      <EmbedClient token={token} initialData={initialData} showTitle={showTitle} />
    </HydrateClient>
  );
}
