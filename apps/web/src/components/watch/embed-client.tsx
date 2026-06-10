"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Loader2, Lock, Mail, Video } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";
import { api } from "@/trpc/react";
import { useViewTracking } from "@/lib/use-view-tracking";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/components/player/video-player";

type ShareData = inferRouterOutputs<AppRouter>["video"]["getByShareToken"];
type ShareOkData = Extract<ShareData, { state: "ok" }>;

/**
 * Bare iframe-safe player for /embed/[token]. Dark chrome only — no app
 * theme dependency beyond the primary accent.
 */
export function EmbedClient({
  token,
  initialData,
  showTitle,
}: {
  token: string;
  initialData: ShareData;
  showTitle: boolean;
}) {
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>();
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();

  const query = api.video.getByShareToken.useQuery(
    {
      token,
      embed: true,
      password: submittedPassword,
      viewerEmail: submittedEmail,
    },
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
    return (
      <EmbedShell>
        <p className="text-sm font-medium">This video isn&apos;t available</p>
        <p className="mt-1.5 text-xs text-white/60">{query.error.message}</p>
      </EmbedShell>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <EmbedShell plain>
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-white/70" />
      </EmbedShell>
    );
  }

  switch (data.state) {
    case "password_required":
      return (
        <EmbedShell title={data.title}>
          <EmbedPasswordForm
            loading={query.isFetching}
            onSubmit={(value) => setSubmittedPassword(value)}
          />
        </EmbedShell>
      );
    case "identity_required":
      return (
        <EmbedShell title={data.title}>
          <EmbedEmailForm
            loading={query.isFetching}
            onSubmit={(value) => setSubmittedEmail(value)}
          />
        </EmbedShell>
      );
    case "auth_required":
      return (
        <EmbedShell title={data.title}>
          <p className="text-xs text-white/60">
            This video is only available to members of its workspace.
          </p>
          <a
            href={`/share/${token}`}
            target="_top"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Lock className="h-3.5 w-3.5" /> Sign in to watch
            <ExternalLink className="h-3 w-3" />
          </a>
        </EmbedShell>
      );
    case "processing":
      return (
        <EmbedShell title={data.title}>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-white/70" />
          <p className="mt-3 text-xs text-white/60">
            This video is still processing — it will appear automatically.
          </p>
        </EmbedShell>
      );
    case "ok":
      return (
        <EmbedPlayer
          data={data}
          token={token}
          showTitle={showTitle}
          identityEmail={submittedEmail ?? null}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function EmbedPlayer({
  data,
  token,
  showTitle,
  identityEmail,
}: {
  data: ShareOkData;
  token: string;
  showTitle: boolean;
  identityEmail: string | null;
}) {
  const { track } = useViewTracking({
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

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <VideoPlayer
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
        className="h-full rounded-none"
      />
      {showTitle && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 pb-8 pt-3">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-white drop-shadow">
            <Video className="h-3.5 w-3.5 shrink-0 text-white/80" />
            <span className="truncate">{data.video.title}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dark gate shells (independent of the app theme — embeds are always dark)
// ---------------------------------------------------------------------------

function EmbedShell({
  title,
  plain = false,
  children,
}: {
  title?: string;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-black p-6">
      <div
        className={cn(
          "w-full max-w-sm text-center text-white",
          !plain && "rounded-xl border border-white/10 bg-white/5 p-6",
        )}
      >
        {title && (
          <h1 className="mb-3 truncate text-sm font-semibold leading-snug">{title}</h1>
        )}
        {children}
      </div>
    </div>
  );
}

const embedInputClass =
  "h-9 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function EmbedPasswordForm({
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
      className="space-y-3 text-left"
    >
      <label htmlFor="embed-password" className="block text-xs text-white/70">
        This video is password protected
      </label>
      <input
        id="embed-password"
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter password"
        autoFocus
        className={embedInputClass}
      />
      <button
        type="submit"
        disabled={!value || loading}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <KeyRound className="h-3.5 w-3.5" />
        )}
        Watch video
      </button>
    </form>
  );
}

function EmbedEmailForm({
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
      className="space-y-3 text-left"
    >
      <label htmlFor="embed-email" className="block text-xs text-white/70">
        Enter your email to watch this video
      </label>
      <input
        id="embed-email"
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="you@company.com"
        autoFocus
        className={embedInputClass}
      />
      <button
        type="submit"
        disabled={!value.includes("@") || loading}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mail className="h-3.5 w-3.5" />
        )}
        Continue
      </button>
    </form>
  );
}
