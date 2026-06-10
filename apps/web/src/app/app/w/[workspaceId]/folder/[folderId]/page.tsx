import { redirect } from "next/navigation";

import { FolderHeader } from "@/components/library/folder-header";
import { LIBRARY_PAGE_SIZE } from "@/components/library/types";
import { VideoGrid } from "@/components/library/video-grid";
import { api, HydrateClient } from "@/trpc/server";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ workspaceId: string; folderId: string }>;
}) {
  const { workspaceId, folderId } = await params;

  try {
    await api.workspace.get({ workspaceId });
  } catch {
    redirect("/app");
  }

  void api.folder.list.prefetch({ workspaceId });
  void api.video.list.prefetchInfinite(
    { workspaceId, view: "workspace", folderId, limit: LIBRARY_PAGE_SIZE, cursor: 0 },
    { initialCursor: 0 },
  );

  return (
    <HydrateClient>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <FolderHeader workspaceId={workspaceId} folderId={folderId} />
        <VideoGrid workspaceId={workspaceId} view="workspace" folderId={folderId} />
      </main>
    </HydrateClient>
  );
}
