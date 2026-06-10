"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Loader2,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/trpc/react";
import { cn, formatDuration, slugify } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeTranscript,
  type WatchTranscriptSegment,
} from "@/components/watch/types";

const EXPORT_FORMATS = ["vtt", "srt", "txt"] as const;

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={key++} className="rounded-sm bg-primary/20 text-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function TranscriptPanel({
  videoId,
  shareToken,
  currentTimeMs,
  seekTo,
  canEdit = false,
  videoTitle,
  className,
}: {
  videoId: string;
  shareToken?: string;
  currentTimeMs: number;
  seekTo: (ms: number) => void;
  /** Owners can edit segments inline and export the transcript. */
  canEdit?: boolean;
  videoTitle?: string;
  className?: string;
}) {
  const utils = api.useUtils();
  const transcriptQuery = api.transcript.get.useQuery({ videoId, shareToken });
  const transcript = normalizeTranscript(transcriptQuery.data);

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [exporting, setExporting] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef(new Map<string, HTMLButtonElement>());

  const updateSegment = api.transcript.updateSegment.useMutation({
    onSuccess: () => {
      void utils.transcript.get.invalidate({ videoId, shareToken });
      setEditingId(null);
      toast.success("Segment updated");
    },
    onError: (error) => toast.error(error.message || "Couldn't update segment"),
  });

  const segments = transcript?.segments ?? [];
  const query = search.trim().toLowerCase();
  const visibleSegments = query
    ? segments.filter((s) => s.text.toLowerCase().includes(query))
    : segments;

  const activeSegment = segments
    .filter((s) => s.startMs <= currentTimeMs)
    .at(-1);
  const activeId = activeSegment?.id;

  // Autoscroll to the active segment while playing (skip while searching/editing).
  useEffect(() => {
    if (!activeId || query || editingId) return;
    const el = segmentRefs.current.get(activeId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, query, editingId]);

  const handleExport = async (format: (typeof EXPORT_FORMATS)[number]) => {
    setExporting(true);
    try {
      const content = await utils.transcript.export.fetch({ videoId, format });
      const blob = new Blob([String(content)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(videoTitle ?? "") || "transcript"}-${Date.now()}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't export the transcript",
      );
    } finally {
      setExporting(false);
    }
  };

  if (transcriptQuery.isLoading) {
    return (
      <div className={cn("space-y-3 p-3", className)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-3 w-10 shrink-0" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    );
  }

  if (!transcript || (transcript.status === "ready" && segments.length === 0)) {
    return (
      <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
        <FileText className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No transcript is available for this video.
        </p>
      </div>
    );
  }

  if (transcript.status === "pending" || transcript.status === "processing") {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          The transcript is still being generated…
        </p>
      </div>
    );
  }

  if (transcript.status === "failed") {
    return (
      <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
        <FileText className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Transcription failed for this video.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcript…"
            aria-label="Search transcript"
            className="h-8 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exporting}>
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Format</DropdownMenuLabel>
              {EXPORT_FORMATS.map((format) => (
                <DropdownMenuItem key={format} onClick={() => void handleExport(format)}>
                  .{format}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div ref={listRef} className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {visibleSegments.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            No matches for “{search}”.
          </p>
        ) : (
          visibleSegments.map((segment) => (
            <TranscriptRow
              key={segment.id}
              segment={segment}
              active={segment.id === activeId && !query}
              search={query}
              canEdit={canEdit}
              isEditing={editingId === segment.id}
              editText={editText}
              setEditText={setEditText}
              saving={updateSegment.isPending && editingId === segment.id}
              onSeek={() => seekTo(segment.startMs)}
              onStartEdit={() => {
                setEditingId(segment.id);
                setEditText(segment.text);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={() => {
                const text = editText.trim();
                if (!text) return;
                updateSegment.mutate({ segmentId: segment.id, text });
              }}
              registerRef={(el) => {
                if (el) segmentRefs.current.set(segment.id, el);
                else segmentRefs.current.delete(segment.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TranscriptRow({
  segment,
  active,
  search,
  canEdit,
  isEditing,
  editText,
  setEditText,
  saving,
  onSeek,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  registerRef,
}: {
  segment: WatchTranscriptSegment;
  active: boolean;
  search: string;
  canEdit: boolean;
  isEditing: boolean;
  editText: string;
  setEditText: (text: string) => void;
  saving: boolean;
  onSeek: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  if (isEditing) {
    return (
      <div className="space-y-2 rounded-lg bg-accent/50 p-2">
        <div className="text-xs tabular-nums text-muted-foreground">
          {formatDuration(segment.startMs)}
        </div>
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={3}
          autoFocus
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSaveEdit} disabled={saving || !editText.trim()}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/seg relative">
      <button
        ref={registerRef}
        type="button"
        onClick={onSeek}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50",
          active && "bg-accent text-accent-foreground",
        )}
      >
        <span
          className={cn(
            "mt-0.5 w-11 shrink-0 text-xs tabular-nums",
            active ? "font-semibold text-primary" : "text-muted-foreground",
          )}
        >
          {formatDuration(segment.startMs)}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {segment.speakerLabel && (
            <span className="mr-1 font-medium text-muted-foreground">
              {segment.speakerLabel}:
            </span>
          )}
          {highlightMatch(segment.text, search)}
        </span>
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={onStartEdit}
          aria-label="Edit segment"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/seg:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
