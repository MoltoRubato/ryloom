import Link from "next/link";
import { redirect } from "next/navigation";
import { Video } from "lucide-react";

import { CreateFolderButton } from "@/components/library/create-folder-button";
import { LIBRARY_PAGE_SIZE, type LibraryView } from "@/components/library/types";
import { VideoGrid } from "@/components/library/video-grid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, HydrateClient } from "@/trpc/server";

const VIEW_TABS = [
  { value: "my_videos", label: "My videos" },
  { value: "workspace", label: "Team library" },
  { value: "shared_with_me", label: "Shared with me" },
  { value: "watch_later", label: "Watch later" },
  { value: "drafts", label: "Drafts" },
  { value: "archived", label: "Archived" },
  { value: "trash", label: "Trash" },
] as const satisfies ReadonlyArray<{ value: LibraryView; label: string }>;

function isLibraryView(value: string | undefined): value is LibraryView {
  return VIEW_TABS.some((tab) => tab.value === value);
}

export default async function WorkspaceLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const rawView = typeof sp.view === "string" ? sp.view : undefined;
  const view: LibraryView = isLibraryView(rawView) ? rawView : "my_videos";

  let workspaceName: string;
  try {
    const result = await api.workspace.get({ workspaceId });
    workspaceName = result.workspace.name;
  } catch {
    redirect("/app");
  }

  void api.video.list.prefetchInfinite(
    { workspaceId, view, limit: LIBRARY_PAGE_SIZE, cursor: 0 },
    { initialCursor: 0 },
  );

  return (
    <HydrateClient>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
              {workspaceName}
            </h1>
            <p className="text-sm text-muted-foreground">Your team&apos;s video library</p>
          </div>
          <div className="flex items-center gap-2">
            <CreateFolderButton workspaceId={workspaceId} />
            <Button asChild>
              <Link href={`/record?workspaceId=${workspaceId}`}>
                <Video className="h-4 w-4" />
                New video
              </Link>
            </Button>
          </div>
        </div>

        <div className="border-b border-border">
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Library views">
            {VIEW_TABS.map((tab) => (
              <Link
                key={tab.value}
                href={
                  tab.value === "my_videos"
                    ? `/app/w/${workspaceId}`
                    : `/app/w/${workspaceId}?view=${tab.value}`
                }
                aria-current={view === tab.value ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  view === tab.value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>

        <VideoGrid workspaceId={workspaceId} view={view} />
      </main>
    </HydrateClient>
  );
}
