import { Suspense } from "react";
import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { EditStudioSkeleton } from "@/components/edit/edit-skeleton";
import { EditStudio } from "@/components/edit/edit-studio";
import { api, HydrateClient } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Edit video · Ryloom",
};

type PageProps = {
  params: Promise<{ videoId: string }>;
};

export default async function VideoEditPage({ params }: PageProps) {
  const { videoId } = await params;
  return (
    <HydrateClient>
      <Suspense fallback={<EditStudioSkeleton />}>
        <EditPageContent videoId={videoId} />
      </Suspense>
    </HydrateClient>
  );
}

async function EditPageContent({ videoId }: { videoId: string }) {
  try {
    const data = await api.video.get({ videoId });
    const workspace = await api.workspace.get({ workspaceId: data.video.workspaceId });
    return <EditStudio data={data} plan={workspace.plan} />;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
