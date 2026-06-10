"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  Building2,
  Check,
  Copy,
  Download,
  Eye,
  Folder,
  FolderInput,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Scissors,
  Share2,
  Sparkles,
  Trash2,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";
import { api } from "@/trpc/react";
import { useViewTracking } from "@/lib/use-view-tracking";
import { formatCount, formatDuration, slugify } from "@/lib/utils";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiPanel } from "@/components/watch/ai-panel";
import { CommentsPanel } from "@/components/watch/comments-panel";
import { ProcessingPanel } from "@/components/watch/processing-panel";
import { ShareDialog } from "@/components/watch/share-dialog";
import { TranscriptPanel } from "@/components/watch/transcript-panel";
import { normalizeFolders } from "@/components/watch/types";

type WatchData = inferRouterOutputs<AppRouter>["video"]["get"];

const PRIVACY_META: Record<string, { label: string; icon: LucideIcon }> = {
  private: { label: "Private", icon: Lock },
  workspace: { label: "Workspace", icon: Building2 },
  specific: { label: "Specific people", icon: UserPlus },
  public: { label: "Public", icon: Globe },
  password: { label: "Password protected", icon: KeyRound },
};

export function WatchPageClient({
  videoId,
  initialData,
}: {
  videoId: string;
  initialData: WatchData;
}) {
  const router = useRouter();
  const utils = api.useUtils();

  const query = api.video.get.useQuery(
    { videoId },
    { initialData, refetchOnWindowFocus: false },
  );
  const data = query.data ?? initialData;
  const video = data.video;

  const playerRef = useRef<VideoPlayerHandle>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // ----- View tracking (workspace members watching someone else's video) -----

  const trackingEnabled = !data.isOwner && video.status === "ready";
  const { track } = useViewTracking({ videoId, enabled: trackingEnabled });
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!trackingEnabled || loadedRef.current) return;
    loadedRef.current = true;
    track("video_loaded", 0);
  }, [trackingEnabled, track]);

  // ----- Title editing ----------------------------------------------------------

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(video.title);

  const updateVideo = api.video.update.useMutation({
    onSuccess: () => void utils.video.get.invalidate({ videoId }),
    onError: (error) => toast.error(error.message || "Couldn't update the video"),
  });

  const startEditTitle = () => {
    setTitleDraft(video.title);
    setEditingTitle(true);
  };
  const saveTitle = () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (!next || next === video.title) return;
    updateVideo.mutate(
      { videoId, title: next },
      { onSuccess: () => toast.success("Title updated") },
    );
  };

  // ----- Library actions ----------------------------------------------------------

  const foldersQuery = api.folder.list.useQuery(
    { workspaceId: video.workspaceId },
    { enabled: data.canEdit },
  );
  const folderOptions = normalizeFolders(foldersQuery.data);

  const moveToFolder = api.video.moveToFolder.useMutation({
    onSuccess: () => {
      void utils.video.get.invalidate({ videoId });
      toast.success("Video moved");
    },
    onError: (error) => toast.error(error.message || "Couldn't move the video"),
  });
  const archive = api.video.archive.useMutation({
    onSuccess: () => {
      void utils.video.get.invalidate({ videoId });
      toast.success("Video archived");
    },
    onError: (error) => toast.error(error.message || "Couldn't archive the video"),
  });
  const unarchive = api.video.unarchive.useMutation({
    onSuccess: () => {
      void utils.video.get.invalidate({ videoId });
      toast.success("Video restored from archive");
    },
    onError: (error) => toast.error(error.message || "Couldn't restore the video"),
  });
  const deleteVideo = api.video.delete.useMutation({
    onSuccess: () => {
      toast.success("Video moved to trash");
      router.push(`/app/w/${video.workspaceId}`);
    },
    onError: (error) => toast.error(error.message || "Couldn't delete the video"),
  });

  const copyLink = () => {
    const url = `${window.location.origin}/share/${video.shareToken}`;
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        toast.success("Link copied");
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Couldn't copy the link"),
    );
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { url } = await utils.video.requestDownloadUrl.fetch({ videoId });
      if (!url) throw new Error("Download isn't available yet");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(video.title) || "video"}-${Date.now()}.mp4`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      track("download_clicked", Math.round(playerRef.current?.getCurrentTimeMs() ?? 0));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't prepare the download",
      );
    } finally {
      setDownloading(false);
    }
  };

  const seekTo = (ms: number) => {
    playerRef.current?.seekTo(ms);
    playerRef.current?.play();
  };
  const getCurrentTimeMs = () =>
    playerRef.current?.getCurrentTimeMs() ?? currentTimeMs;

  const privacyMeta = PRIVACY_META[video.privacy] ?? {
    label: video.privacy,
    icon: Lock,
  };
  const PrivacyIcon = privacyMeta.icon;
  const isProcessing = ["draft", "uploading", "processing"].includes(video.status);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      {/* ----- Header ----------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
          <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0">
            <Link href={`/app/w/${video.workspaceId}`} aria-label="Back to library">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            {editingTitle && data.canEdit ? (
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveTitle();
                  }
                  if (e.key === "Escape") {
                    setTitleDraft(video.title);
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                maxLength={300}
                aria-label="Video title"
                className="h-9 max-w-xl text-lg font-semibold"
              />
            ) : data.canEdit ? (
              <button
                type="button"
                onClick={startEditTitle}
                aria-label="Edit title"
                className="group flex max-w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <h1 className="truncate text-xl font-semibold sm:text-2xl">
                  {video.title}
                </h1>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : (
              <h1 className="truncate text-xl font-semibold sm:text-2xl">
                {video.title}
              </h1>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <PrivacyIcon className="h-3 w-3" /> {privacyMeta.label}
              </Badge>
              {video.status === "archived" && (
                <Badge variant="secondary" className="gap-1">
                  <Archive className="h-3 w-3" /> Archived
                </Badge>
              )}
              {video.status === "failed" && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> Failed
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {formatCount(video.viewCount)} views
              </span>
              <span>{format(video.createdAt, "MMM d, yyyy")}</span>
              {video.durationMs !== null && (
                <span className="tabular-nums">{formatDuration(video.durationMs)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {data.canEdit && (
            <Button onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
          )}
          <Button variant="outline" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy link
          </Button>
          {data.canEdit && video.status === "ready" && (
            <Button asChild variant="outline">
              <Link href={`/app/video/${videoId}/edit`}>
                <Scissors className="h-4 w-4" /> Edit
              </Link>
            </Button>
          )}
          {data.canEdit && (
            <Button asChild variant="outline">
              <Link href={`/app/video/${videoId}/analytics`}>
                <BarChart3 className="h-4 w-4" /> Insights
              </Link>
            </Button>
          )}
          {data.canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={downloading || video.status !== "ready"}
                  onClick={() => void handleDownload()}
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download MP4
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput className="h-4 w-4" />
                    Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-64 w-56 overflow-y-auto">
                    <DropdownMenuItem
                      disabled={moveToFolder.isPending}
                      onClick={() => moveToFolder.mutate({ videoId, folderId: null })}
                    >
                      <Folder className="h-4 w-4" />
                      Library (no folder)
                      {video.folderId === null && (
                        <Check className="ml-auto h-3.5 w-3.5" />
                      )}
                    </DropdownMenuItem>
                    {folderOptions.length === 0 ? (
                      <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                    ) : (
                      folderOptions.map((folder) => (
                        <DropdownMenuItem
                          key={folder.id}
                          disabled={moveToFolder.isPending}
                          onClick={() =>
                            moveToFolder.mutate({ videoId, folderId: folder.id })
                          }
                        >
                          {folder.emoji ? (
                            <span className="w-4 text-center">{folder.emoji}</span>
                          ) : (
                            <Folder className="h-4 w-4" />
                          )}
                          <span className="truncate">{folder.name}</span>
                          {video.folderId === folder.id && (
                            <Check className="ml-auto h-3.5 w-3.5" />
                          )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                {video.status === "archived" ? (
                  <DropdownMenuItem
                    disabled={unarchive.isPending}
                    onClick={() => unarchive.mutate({ videoId })}
                  >
                    <ArchiveRestore className="h-4 w-4" /> Unarchive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={archive.isPending || video.status !== "ready"}
                    onClick={() => archive.mutate({ videoId })}
                  >
                    <Archive className="h-4 w-4" /> Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ----- Body --------------------------------------------------------------- */}
      {isProcessing ? (
        <ProcessingPanel
          videoId={videoId}
          status={video.status}
          onStatusChange={(status) => {
            void utils.video.get.invalidate({ videoId });
            if (status === "ready") toast.success("Your video is ready");
            router.refresh();
          }}
        />
      ) : video.status === "failed" ? (
        <FailedPanel
          message={video.processingError}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : (
        <>
          {video.status === "archived" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Archive className="h-4 w-4" />
                This video is archived — it&apos;s hidden from the library and share
                links are paused.
              </p>
              {data.canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unarchive.isPending}
                  onClick={() => unarchive.mutate({ videoId })}
                >
                  {unarchive.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  )}
                  Unarchive
                </Button>
              )}
            </div>
          )}

          <VideoPlayer
            ref={playerRef}
            mp4Url={data.playback.mp4Url}
            hlsUrl={data.playback.hlsUrl}
            captionsUrl={data.playback.captionsUrl}
            poster={data.playback.thumbnailUrl}
            chapters={video.chapters}
            durationMs={video.durationMs}
            cta={video.cta}
            onEvent={(type, playheadMs) => track(type, playheadMs)}
            onTimeUpdate={setCurrentTimeMs}
            className="shadow-sm"
          />

          {video.description && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {video.description}
            </p>
          )}

          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">
                Comments
                {video.commentCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {formatCount(video.commentCount)}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              {data.canEdit && (
                <TabsTrigger value="ai" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> AI
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="comments" className="mt-3">
              <Card className="h-[30rem] gap-0 overflow-hidden p-0">
                <CommentsPanel
                  videoId={videoId}
                  canModerate={data.canEdit}
                  isSignedIn
                  seekTo={seekTo}
                  getCurrentTimeMs={getCurrentTimeMs}
                  onCommented={() =>
                    track("comment_created", Math.round(getCurrentTimeMs()))
                  }
                />
              </Card>
            </TabsContent>

            <TabsContent value="transcript" className="mt-3">
              <Card className="h-[30rem] gap-0 overflow-hidden p-0">
                <TranscriptPanel
                  videoId={videoId}
                  currentTimeMs={currentTimeMs}
                  seekTo={seekTo}
                  canEdit={data.canEdit}
                  videoTitle={video.title}
                />
              </Card>
            </TabsContent>

            {data.canEdit && (
              <TabsContent value="ai" className="mt-3">
                <AiPanel videoId={videoId} workspaceId={video.workspaceId} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {/* ----- Dialogs --------------------------------------------------------------- */}
      {data.canEdit && (
        <ShareDialog video={video} open={shareOpen} onOpenChange={setShareOpen} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              “{video.title}” will move to the trash. You can restore it within 30
              days before it&apos;s permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteVideo.isPending}
              onClick={() => deleteVideo.mutate({ videoId })}
            >
              {deleteVideo.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failed state
// ---------------------------------------------------------------------------

function FailedPanel({
  message,
  onDelete,
}: {
  message: string | null;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <XCircle className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Processing failed</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {message ??
              "Something went wrong while processing this recording. Try recording again — if it keeps happening, contact support."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete video
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (used as the page-level Suspense fallback)
// ---------------------------------------------------------------------------

export function WatchPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-64 sm:w-80" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="h-9 w-72 rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
