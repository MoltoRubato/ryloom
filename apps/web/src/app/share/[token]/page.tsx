import { type Metadata } from "next";
import { TRPCError } from "@trpc/server";

import { ShareErrorCard } from "@/components/watch/error-card";
import { SharePageClient } from "@/components/watch/share-page-client";
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
