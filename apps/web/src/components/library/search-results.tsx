"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Play, Search } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

const MATCHED_IN_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  tags: "Tags",
  transcript: "Transcript",
  summary: "Summary",
  comment: "Comment",
};

function matchedInLabel(matchedIn: string): string {
  return (
    MATCHED_IN_LABELS[matchedIn] ??
    matchedIn.charAt(0).toUpperCase() + matchedIn.slice(1).replace(/_/g, " ")
  );
}

/** Minimal entity decoding for ts_headline output rendered as plain text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Renders a `ts_headline` snippet safely: every tag except `<b>`/`</b>` is
 * stripped, and matches are rendered as React `<strong>` nodes — no HTML is
 * ever injected into the DOM.
 */
function renderSnippet(raw: string): ReactNode {
  const cleaned = raw.replace(/<(?!\/?b>)[^>]*>/gi, " ");
  const parts = cleaned.split(/(<b>[\s\S]*?<\/b>)/gi);
  return parts.map((part, index) => {
    const match = /^<b>([\s\S]*)<\/b>$/i.exec(part);
    if (match) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {decodeEntities(match[1] ?? "")}
        </strong>
      );
    }
    return <Fragment key={index}>{decodeEntities(part)}</Fragment>;
  });
}

export function SearchResults({
  workspaceId,
  initialQuery,
}: {
  workspaceId: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [inputValue, setInputValue] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  // Keep state in sync when the URL changes (e.g. browser back/forward).
  useEffect(() => {
    setInputValue(initialQuery);
    setQuery(initialQuery);
  }, [initialQuery]);

  const trimmedQuery = query.trim();
  const search = api.search.videos.useQuery(
    { workspaceId, query: trimmedQuery },
    { enabled: trimmedQuery.length > 0 },
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = inputValue.trim();
    setQuery(next);
    router.replace(
      next
        ? `/app/w/${workspaceId}/search?q=${encodeURIComponent(next)}`
        : `/app/w/${workspaceId}/search`,
    );
  }

  const results = search.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Search</h1>
        <form onSubmit={handleSubmit} className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Search titles, transcripts, summaries, comments…"
            className="pl-9 pr-24"
            autoFocus
            aria-label="Search videos"
          />
          <Button
            type="submit"
            size="sm"
            className="absolute right-1 top-1/2 h-7 -translate-y-1/2"
            disabled={search.isFetching}
          >
            {search.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Search
          </Button>
        </form>
      </div>

      {trimmedQuery.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Search className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Search this workspace</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Find videos by their title, description, transcript, AI summary, or comments.
          </p>
        </div>
      ) : search.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex gap-4 rounded-xl border border-border bg-card p-3 shadow-sm"
            >
              <Skeleton className="aspect-video w-40 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : search.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{search.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void search.refetch()}>
            Try again
          </Button>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-6 py-20 text-center">
          <h3 className="text-base font-semibold text-foreground">
            No results for “{trimmedQuery}”
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Try a different keyword, or check the spelling.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? "result" : "results"} for “{trimmedQuery}”
          </p>
          {results.map((result) => {
            const posterUrl = result.thumbnailUrl;
            const ownerName = result.owner.name ?? result.owner.email;
            return (
              <Link
                key={result.id}
                href={`/app/video/${result.id}`}
                className="flex gap-4 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:bg-accent/50"
              >
                <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40">
                  {posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={posterUrl}
                      alt={result.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/15 to-primary/5">
                      <Play className="h-6 w-6 text-primary/70" fill="currentColor" />
                    </div>
                  )}
                  {result.durationMs !== null && result.durationMs > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {formatDuration(result.durationMs)}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="min-w-0 truncate text-sm font-semibold text-foreground"
                      title={result.title}
                    >
                      {result.title}
                    </h3>
                    <Badge variant="secondary" className="shrink-0">
                      {matchedInLabel(result.matchedIn)}
                    </Badge>
                  </div>
                  {result.snippet && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {renderSnippet(result.snippet)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar className="h-4 w-4">
                      <AvatarImage src={result.owner.avatarUrl ?? undefined} alt={ownerName} />
                      <AvatarFallback className="text-[8px]">
                        {getInitials(result.owner.name, result.owner.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{ownerName}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">
                      {formatDistanceToNow(result.createdAt, { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
