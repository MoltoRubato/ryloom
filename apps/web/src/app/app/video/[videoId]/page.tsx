import { Suspense } from "react";
import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import {
  WatchPageClient,
  WatchPageSkeleton,
} from "@/components/watch/watch-page-client";
import { api, HydrateClient } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Watch video",
};

type PageProps = {
  params: Promise<{ videoId: string }>;
};

export default async function VideoWatchPage({ params }: PageProps) {
  const { videoId } = await params;
  return (
    <HydrateClient>
      <Suspense fallback={<WatchPageSkeleton />}>
        <WatchPageContent videoId={videoId} />
      </Suspense>
    </HydrateClient>
  );
}

async function WatchPageContent({ videoId }: { videoId: string }) {
  try {
    const data = await api.video.get({ videoId });
    return <WatchPageClient videoId={videoId} initialData={data} />;
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }
}
