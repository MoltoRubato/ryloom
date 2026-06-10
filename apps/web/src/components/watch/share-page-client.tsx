"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";
import { api } from "@/trpc/react";
import { createClient } from "@/lib/supabase/client";
import { useViewTracking } from "@/lib/use-view-tracking";
import { cn, formatCount, getInitials } from "@/lib/utils";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommentsPanel } from "@/components/watch/comments-panel";
import { ShareErrorCard } from "@/components/watch/error-card";
import { ReactionsBar } from "@/components/watch/reactions-bar";
import { TranscriptPanel } from "@/components/watch/transcript-panel";
import { normalizeTranscript } from "@/components/watch/types";

type ShareData = inferRouterOutputs<AppRouter>["video"]["getByShareToken"];
type ShareOkData = Extract<ShareData, { state: "ok" }>;

export function SharePageClient({
  token,
  initialData,
}: {
  token: string;
  initialData: ShareData;
}) {
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>();
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();

  const query = api.video.getByShareToken.useQuery(
    { token, password: submittedPassword, viewerEmail: submittedEmail },
    {
      initialData:
        submittedPassword === undefined && submittedEmail === undefined
          ? initialData
          : undefined,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (q) => (q.state.data?.state === "processing" ? 5000 : false),
    },
  );

  // Wrong password → toast and return to the password form.
  useEffect(() => {
    const error = query.error;
    if (!error) return;
    if (error.data?.code === "UNAUTHORIZED") {
      toast.error(error.message || "Incorrect password");
      setSubmittedPassword(undefined);
    }
  }, [query.error]);

  if (query.error && query.error.data?.code !== "UNAUTHORIZED") {
    return <ShareErrorCard message={query.error.message} />;
  }

  const data = query.data;
  if (!data) {
    return <SharePageSkeleton />;
  }

  switch (data.state) {
    case "password_required":
      return (
        <GateShell title={data.title}>
          <PasswordGate
            loading={query.isFetching}
            onSubmit={(value) => setSubmittedPassword(value)}
          />
        </GateShell>
      );
    case "identity_required":
      return (
        <GateShell title={data.title}>
          <IdentityGate
            loading={query.isFetching}
            onSubmit={(value) => setSubmittedEmail(value)}
          />
        </GateShell>
      );
    case "auth_required":
      return (
        <GateShell title={data.title}>
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              This video is only available to members of its workspace.
            </p>
            <Button asChild className="w-full">
              <Link href={`/login?next=${encodeURIComponent(`/share/${token}`)}`}>
                <Lock className="h-4 w-4" /> Sign in to watch
              </Link>
            </Button>
          </div>
        </GateShell>
      );
    case "processing":
      return (
        <GateShell title={data.title}>
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              This video is still processing. The page will refresh automatically
              when it's ready.
            </p>
          </div>
        </GateShell>
      );
    case "ok":
      return (
        <ShareWatchView
          data={data}
          token={token}
          identityEmail={submittedEmail ?? null}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Gate shells (password / identity / auth / processing)
// ---------------------------------------------------------------------------

function GateShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md gap-0 p-8">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Video className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold leading-snug">{title}</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}

function PasswordGate({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (password: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSubmit(value);
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="gate-password">This video is password protected</Label>
        <Input
          id="gate-password"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter password"
          autoFocus
        />
      </div>
      <Button type="submit" className="w-full" disabled={!value || loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <KeyRound className="h-4 w-4" />
        )}
        Watch video
      </Button>
    </form>
  );
}

function IdentityGate({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (email: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.includes("@")) onSubmit(value.trim().toLowerCase());
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="gate-email">Enter your email to watch</Label>
        <p className="text-xs text-muted-foreground">
          The video owner asks viewers to identify themselves.
        </p>
        <Input
          id="gate-email"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="you@company.com"
          autoFocus
        />
      </div>
      <Button type="submit" className="w-full" disabled={!value.includes("@") || loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        Continue
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main watch view
// ---------------------------------------------------------------------------

function ShareWatchView({
  data,
  token,
  identityEmail,
}: {
  data: ShareOkData;
  token: string;
  identityEmail: string | null;
}) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data: auth }) => {
      setIsSignedIn(auth.user !== null);
    });
  }, []);

  const { track, anonymousId } = useViewTracking({
    videoId: data.video.id,
    shareToken: token,
    identityEmail,
    enabled: !data.viewerIsOwner,
  });

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    track("video_loaded", 0);
  }, [track]);

  const hideBranding = data.workspace?.hideBranding === true;
  const canViewTranscript = data.permissions.canViewTranscript;
  const transcriptQuery = api.transcript.get.useQuery(
    { videoId: data.video.id, shareToken: token },
    { enabled: canViewTranscript },
  );
  const transcriptAvailable =
    canViewTranscript && normalizeTranscript(transcriptQuery.data) !== null;
  const showComments = data.permissions.canComment;
  const showSidebar = showComments || transcriptAvailable;

  const seekTo = (ms: number) => {
    playerRef.current?.seekTo(ms);
    playerRef.current?.play();
  };
  const getCurrentTimeMs = () =>
    playerRef.current?.getCurrentTimeMs() ?? currentTimeMs;

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const description = data.video.description?.trim() ?? "";
  const descriptionLong = description.length > 220;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Branding header */}
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {!hideBranding ? (
            <div className="flex items-center gap-2.5">
              {data.workspace?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.workspace.logoUrl}
                  alt={data.workspace.name}
                  className="h-7 w-7 rounded-md object-cover"
                />
              ) : (
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
                  style={
                    data.workspace?.brandColor
                      ? { backgroundColor: data.workspace.brandColor }
                      : undefined
                  }
                >
                  <Video className="h-3.5 w-3.5" />
                </div>
              )}
              <span className="text-sm font-semibold">
                {data.workspace?.name ?? "Ryloom"}
              </span>
            </div>
          ) : (
            <div />
          )}
          {!hideBranding && (
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <Video className="h-3.5 w-3.5" /> Record with Ryloom
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {/* Title + meta */}
        <div className="mb-4">
          <h1 className="text-xl font-semibold sm:text-2xl">{data.video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {data.owner && (
              <span className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage
                    src={data.owner.avatarUrl ?? undefined}
                    alt={data.owner.name ?? "Owner"}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(data.owner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">
                  {data.owner.name ?? "Unknown"}
                </span>
              </span>
            )}
            <span>{format(data.video.createdAt, "MMM d, yyyy")}</span>
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {formatCount(data.video.viewCount)} views
            </span>
          </div>
        </div>

        <div
          className={cn(
            "grid gap-6",
            showSidebar ? "lg:grid-cols-3" : "mx-auto max-w-4xl",
          )}
        >
          {/* Player column */}
          <div className={cn("min-w-0 space-y-4", showSidebar && "lg:col-span-2")}>
            <VideoPlayer
              ref={playerRef}
              mp4Url={data.playback.mp4Url}
              hlsUrl={data.playback.hlsUrl}
              captionsUrl={data.playback.captionsUrl}
              poster={data.playback.thumbnailUrl}
              chapters={data.video.chapters}
              durationMs={data.video.durationMs}
              watermarkEmail={data.watermarkEmail}
              cta={data.video.cta}
              brandColor={data.workspace?.brandColor}
              onEvent={(type, playheadMs) => track(type, playheadMs)}
              onTimeUpdate={setCurrentTimeMs}
              className="shadow-sm"
            />

            {/* Reactions */}
            {data.permissions.canReact && (
              <ReactionsBar
                videoId={data.video.id}
                shareToken={token}
                anonymousId={anonymousId}
                getCurrentTimeMs={getCurrentTimeMs}
                onReacted={(_, timestampMs) => track("reaction_added", timestampMs)}
              />
            )}

            {/* Description */}
            {description && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p
                  className={cn(
                    "whitespace-pre-wrap text-sm leading-relaxed",
                    descriptionLong && !descExpanded && "line-clamp-3",
                  )}
                >
                  {description}
                </p>
                {descriptionLong && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded((p) => !p)}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
                  >
                    {descExpanded ? "Show less" : "Show more"}
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        descExpanded && "rotate-180",
                      )}
                    />
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copy link
              </Button>
              {data.permissions.canDownload && data.playback.downloadUrl && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={data.playback.downloadUrl}
                    download
                    onClick={() =>
                      track("download_clicked", Math.round(getCurrentTimeMs()))
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </Button>
              )}
              {data.viewerIsOwner && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/video/${data.video.id}`}>
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Ryloom
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {/* Sidebar */}
          {showSidebar && (
            <div className="min-w-0">
              <Card className="flex h-[34rem] flex-col gap-0 overflow-hidden p-0">
                <Tabs
                  defaultValue={showComments ? "comments" : "transcript"}
                  className="flex h-full flex-col gap-0"
                >
                  <TabsList className="m-2 grid w-auto shrink-0 grid-cols-2">
                    {transcriptAvailable && (
                      <TabsTrigger value="transcript">Transcript</TabsTrigger>
                    )}
                    {showComments && (
                      <TabsTrigger value="comments">Comments</TabsTrigger>
                    )}
                  </TabsList>
                  {transcriptAvailable && (
                    <TabsContent
                      value="transcript"
                      className="mt-0 min-h-0 flex-1 overflow-hidden"
                    >
                      <TranscriptPanel
                        videoId={data.video.id}
                        shareToken={token}
                        currentTimeMs={currentTimeMs}
                        seekTo={seekTo}
                      />
                    </TabsContent>
                  )}
                  {showComments && (
                    <TabsContent
                      value="comments"
                      className="mt-0 min-h-0 flex-1 overflow-hidden"
                    >
                      <CommentsPanel
                        videoId={data.video.id}
                        shareToken={token}
                        canModerate={data.viewerIsOwner}
                        isSignedIn={isSignedIn}
                        seekTo={seekTo}
                        getCurrentTimeMs={getCurrentTimeMs}
                        onCommented={() =>
                          track("comment_created", Math.round(getCurrentTimeMs()))
                        }
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      {!hideBranding && (
        <footer className="border-t border-border py-4">
          <Link
            href="/"
            className="mx-auto flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Powered by
            <span className="flex items-center gap-1 font-semibold text-foreground">
              <Video className="h-3 w-3 text-primary" /> Ryloom
            </span>
          </Link>
        </footer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SharePageSkeleton() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Skeleton className="h-7 w-2/3 max-w-md" />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="mt-5 grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-[34rem] rounded-xl" />
        </div>
      </div>
    </div>
  );
}
