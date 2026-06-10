"use client";

import { useEffect, useRef } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LibraryEmptyState } from "@/components/library/empty-state";
import { LIBRARY_PAGE_SIZE, type LibraryView } from "@/components/library/types";
import { VideoCard } from "@/components/library/video-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/trpc/react";

const GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export function VideoGrid({
  workspaceId,
  view,
  folderId,
}: {
  workspaceId: string;
  view: LibraryView;
  folderId?: string;
}) {
  const utils = api.useUtils();

  const listInput = folderId
    ? { workspaceId, view, folderId, limit: LIBRARY_PAGE_SIZE }
    : { workspaceId, view, limit: LIBRARY_PAGE_SIZE };

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = api.video.list.useInfiniteQuery(listInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialCursor: 0,
  });

  const purge = api.video.purgeOldTrash.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.purged > 0
          ? `Permanently deleted ${result.purged} ${result.purged === 1 ? "video" : "videos"}`
          : "No videos in trash were older than 30 days",
      );
      await Promise.all([utils.video.list.invalidate(), utils.video.counts.invalidate()]);
    },
    onError: (err) => toast.error(err.message),
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      {view === "trash" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Videos in trash are permanently deleted after 30 days.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={purge.isPending}>
                {purge.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Empty trash
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Empty trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes every video that has been in trash for more than 30
                  days, including all of their views, comments, and assets. This can&apos;t be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => purge.mutate({ workspaceId })}
                >
                  Empty trash
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {isLoading ? (
        <GridSkeleton />
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            {error.message || "Something went wrong while loading videos."}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <LibraryEmptyState view={view} workspaceId={workspaceId} isFolder={Boolean(folderId)} />
      ) : (
        <>
          <div className={GRID_CLASS}>
            {items.map((item) => (
              <VideoCard key={item.video.id} item={item} view={view} workspaceId={workspaceId} />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden className="h-px" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className={GRID_CLASS}>
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        >
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="space-y-2.5 p-3">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
