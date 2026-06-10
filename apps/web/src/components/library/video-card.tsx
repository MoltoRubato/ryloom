"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FolderInput,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { MoveToFolderDialog } from "@/components/library/move-to-folder-dialog";
import type { LibraryView, VideoListItem } from "@/components/library/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCount, formatDuration, getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

export function VideoCard({
  item,
  view,
  workspaceId,
}: {
  item: VideoListItem;
  view: LibraryView;
  workspaceId: string;
}) {
  const { video, owner } = item;
  const utils = api.useUtils();

  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(video.title);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirm, setConfirm] = useState<"trash" | "forever" | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const invalidateLists = async () => {
    await Promise.all([utils.video.list.invalidate(), utils.video.counts.invalidate()]);
  };

  const updateVideo = api.video.update.useMutation({
    onSuccess: () => invalidateLists(),
    onError: (err) => toast.error(err.message),
  });
  const toggleWatchLater = api.video.toggleWatchLater.useMutation({
    onSuccess: async (result) => {
      toast.success(result.saved ? "Added to Watch later" : "Removed from Watch later");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });
  const archiveVideo = api.video.archive.useMutation({
    onSuccess: async () => {
      toast.success("Video archived");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });
  const unarchiveVideo = api.video.unarchive.useMutation({
    onSuccess: async () => {
      toast.success("Video unarchived");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteVideo = api.video.delete.useMutation({
    onSuccess: async () => {
      toast.success("Video moved to trash");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });
  const restoreVideo = api.video.restore.useMutation({
    onSuccess: async () => {
      toast.success("Video restored");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteForever = api.video.deleteForever.useMutation({
    onSuccess: async () => {
      toast.success("Video permanently deleted");
      await invalidateLists();
    },
    onError: (err) => toast.error(err.message),
  });

  function startEditing() {
    setDraftTitle(video.title);
    setIsEditing(true);
  }

  function commitRename() {
    setIsEditing(false);
    const next = draftTitle.trim();
    if (!next || next === video.title) return;
    updateVideo.mutate({ videoId: video.id, title: next });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/${video.shareToken}`);
      toast.success("Share link copied to clipboard");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const { url } = await utils.video.requestDownloadUrl.fetch({ videoId: video.id });
      if (!url) throw new Error("Download isn't available yet");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't prepare the download");
    } finally {
      setIsDownloading(false);
    }
  }

  const isTrash = view === "trash";
  const posterUrl = video.customThumbnailUrl ?? video.thumbnailUrl;
  const showAnimated = isHovered && video.animatedThumbnailUrl !== null;
  const thumbSrc = showAnimated ? (video.animatedThumbnailUrl ?? posterUrl) : posterUrl;
  const ownerName = owner.name ?? owner.email;

  const thumbnailInner = (
    <>
      {thumbSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbSrc}
          alt={video.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/15 to-primary/5">
          <Play className="h-10 w-10 text-primary/70" fill="currentColor" />
        </div>
      )}
      {video.durationMs !== null && video.durationMs > 0 && (
        <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">
          {formatDuration(video.durationMs)}
        </span>
      )}
      {video.status === "processing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-white">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs font-medium">Processing…</span>
        </div>
      )}
      {video.status === "uploading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-white">
          <UploadCloud className="h-6 w-6" />
          <span className="text-xs font-medium">Uploading…</span>
        </div>
      )}
      {video.status === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-white">
          <AlertTriangle className="h-6 w-6 text-red-400" />
          <span className="text-xs font-medium">Processing failed</span>
        </div>
      )}
    </>
  );

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isTrash ? (
        <div className="relative block aspect-video w-full overflow-hidden bg-muted">
          {thumbnailInner}
        </div>
      ) : (
        <Link
          href={`/app/video/${video.id}`}
          className="relative block aspect-video w-full overflow-hidden bg-muted"
          aria-label={`Open ${video.title}`}
        >
          {thumbnailInner}
        </Link>
      )}

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start gap-1">
          {isEditing ? (
            <Input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") setIsEditing(false);
              }}
              autoFocus
              maxLength={300}
              className="h-7 flex-1 text-sm"
              aria-label="Video title"
            />
          ) : isTrash ? (
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={video.title}>
              {video.title}
            </h3>
          ) : (
            <Link
              href={`/app/video/${video.id}`}
              className="min-w-0 flex-1"
              onDoubleClick={(event) => {
                event.preventDefault();
                startEditing();
              }}
            >
              <h3 className="truncate text-sm font-semibold text-foreground" title={video.title}>
                {video.title}
              </h3>
            </Link>
          )}

          {!isTrash && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground transition-opacity data-[state=open]:opacity-100 sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                  aria-label="Video actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => void handleCopyLink()}>
                  <LinkIcon className="h-4 w-4" />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/app/video/${video.id}`}>
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(startEditing, 0)}>
                  <Pencil className="h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                  <FolderInput className="h-4 w-4" />
                  Move to folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={toggleWatchLater.isPending}
                  onSelect={() => toggleWatchLater.mutate({ videoId: video.id })}
                >
                  <Clock className="h-4 w-4" />
                  {view === "watch_later" ? "Remove from Watch later" : "Watch later"}
                </DropdownMenuItem>
                {video.status === "archived" ? (
                  <DropdownMenuItem
                    disabled={unarchiveVideo.isPending}
                    onSelect={() => unarchiveVideo.mutate({ videoId: video.id })}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Unarchive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={video.status !== "ready" || archiveVideo.isPending}
                    onSelect={() => archiveVideo.mutate({ videoId: video.id })}
                  >
                    <Archive className="h-4 w-4" />
                    Archive
                  </DropdownMenuItem>
                )}
                {video.status === "ready" && (
                  <DropdownMenuItem
                    disabled={isDownloading}
                    onSelect={(event) => {
                      event.preventDefault();
                      void handleDownload();
                    }}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirm("trash")}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Avatar className="h-5 w-5">
            <AvatarImage src={owner.avatarUrl ?? undefined} alt={ownerName} />
            <AvatarFallback className="text-[9px]">
              {getInitials(owner.name, owner.email)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{ownerName}</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">
            {formatDistanceToNow(video.createdAt, { addSuffix: true })}
          </span>
        </div>

        <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {formatCount(video.viewCount)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {formatCount(video.commentCount)}
          </span>
          {video.status === "draft" && (
            <Badge variant="secondary" className="ml-auto">
              Draft
            </Badge>
          )}
        </div>

        {isTrash && (
          <div className="mt-1 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={restoreVideo.isPending}
              onClick={() => restoreVideo.mutate({ videoId: video.id })}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-destructive hover:text-destructive"
              disabled={deleteForever.isPending}
              onClick={() => setConfirm("forever")}
            >
              <Trash2 className="h-4 w-4" />
              Delete forever
            </Button>
          </div>
        )}
      </div>

      <MoveToFolderDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        videoId={video.id}
        workspaceId={workspaceId}
        currentFolderId={video.folderId}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "forever" ? "Delete forever?" : "Move to trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "forever"
                ? `“${video.title}” and all of its views, comments, and assets will be permanently deleted. This can't be undone.`
                : `“${video.title}” will be moved to trash and permanently deleted after 30 days.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm === "forever") {
                  deleteForever.mutate({ videoId: video.id });
                } else {
                  deleteVideo.mutate({ videoId: video.id });
                }
                setConfirm(null);
              }}
            >
              {confirm === "forever" ? "Delete forever" : "Move to trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
