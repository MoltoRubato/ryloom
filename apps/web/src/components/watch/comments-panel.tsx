"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Reply,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/trpc/react";
import { cn, formatDuration, getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { normalizeComments, type WatchComment } from "@/components/watch/types";

const GUEST_NAME_KEY = "ryloom_guest_name";

function readGuestName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function CommentsPanel({
  videoId,
  shareToken,
  canModerate,
  isSignedIn,
  seekTo,
  getCurrentTimeMs,
  onCommented,
  className,
}: {
  videoId: string;
  shareToken?: string;
  canModerate: boolean;
  /** Signed-in users comment with their identity; guests are asked for a name once. */
  isSignedIn: boolean;
  seekTo: (ms: number) => void;
  getCurrentTimeMs: () => number;
  onCommented?: () => void;
  className?: string;
}) {
  const utils = api.useUtils();
  const listQuery = api.comment.list.useQuery({ videoId, shareToken });
  const comments = normalizeComments(listQuery.data);

  const [guestName, setGuestName] = useState("");
  const [guestNameSaved, setGuestNameSaved] = useState(false);
  useEffect(() => {
    const saved = readGuestName();
    if (saved) {
      setGuestName(saved);
      setGuestNameSaved(true);
    }
  }, []);

  const [body, setBody] = useState("");
  const [timestampMs, setTimestampMs] = useState<number | null>(null);
  const [timestampCaptured, setTimestampCaptured] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const invalidate = () => utils.comment.list.invalidate({ videoId, shareToken });

  const createComment = api.comment.create.useMutation({
    onSuccess: () => {
      void invalidate();
      onCommented?.();
    },
    onError: (error) => toast.error(error.message || "Couldn't post comment"),
  });
  const resolveComment = api.comment.resolve.useMutation({
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(error.message || "Couldn't update comment"),
  });
  const deleteComment = api.comment.delete.useMutation({
    onSuccess: () => {
      void invalidate();
      toast.success("Comment deleted");
    },
    onError: (error) => toast.error(error.message || "Couldn't delete comment"),
  });

  const needsGuestName = !isSignedIn && !guestNameSaved;

  const persistGuestName = () => {
    const trimmed = guestName.trim();
    if (!trimmed) return false;
    try {
      window.localStorage.setItem(GUEST_NAME_KEY, trimmed);
    } catch {
      // localStorage unavailable — still allow commenting this session.
    }
    setGuestNameSaved(true);
    return true;
  };

  const handleComposerFocus = () => {
    if (!timestampCaptured) {
      setTimestampMs(Math.max(0, Math.round(getCurrentTimeMs())));
      setTimestampCaptured(true);
    }
  };

  const toggleTimestamp = () => {
    if (timestampMs === null) {
      setTimestampMs(Math.max(0, Math.round(getCurrentTimeMs())));
    } else {
      setTimestampMs(null);
    }
    setTimestampCaptured(true);
  };

  const submitComment = (parentCommentId: string | null) => {
    const text = (parentCommentId ? replyBody : body).trim();
    if (!text) return;
    if (!isSignedIn) {
      if (!guestName.trim()) {
        toast.error("Add your name so people know who's commenting");
        return;
      }
      if (!guestNameSaved) persistGuestName();
    }
    createComment.mutate(
      {
        videoId,
        shareToken,
        body: text,
        timestampMs:
          parentCommentId === null && timestampMs !== null ? timestampMs : undefined,
        parentCommentId: parentCommentId ?? undefined,
        guestName: !isSignedIn ? guestName.trim() : undefined,
      },
      {
        onSuccess: () => {
          if (parentCommentId) {
            setReplyBody("");
            setReplyTo(null);
          } else {
            setBody("");
            setTimestampMs(null);
            setTimestampCaptured(false);
          }
        },
      },
    );
  };

  const topLevel = comments
    .filter((c) => c.parentCommentId === null && c.status !== "deleted")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const repliesFor = (id: string) =>
    comments
      .filter((c) => c.parentCommentId === id && c.status !== "deleted")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const displayName = (comment: WatchComment) =>
    comment.author?.name ?? comment.guestName ?? comment.author?.email ?? "Viewer";

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Composer */}
      <div className="space-y-2 border-b border-border p-3">
        {needsGuestName && (
          <Input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            className="h-8 text-sm"
            maxLength={80}
          />
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={handleComposerFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submitComment(null);
            }
          }}
          placeholder="Leave a comment…"
          rows={2}
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleTimestamp}
            aria-pressed={timestampMs !== null}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              timestampMs !== null
                ? "border-primary/40 bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
          >
            <Clock className="h-3 w-3" />
            {timestampMs !== null
              ? `at ${formatDuration(timestampMs)}`
              : "Add timestamp"}
          </button>
          <Button
            size="sm"
            onClick={() => submitComment(null)}
            disabled={!body.trim() || createComment.isPending}
          >
            {createComment.isPending && replyTo === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Post
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {listQuery.isLoading ? (
          <div className="space-y-3 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : topLevel.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No comments yet. Start the conversation.
            </p>
          </div>
        ) : (
          topLevel.map((comment) => (
            <div
              key={comment.id}
              className={cn(
                "rounded-lg p-2 transition-colors hover:bg-accent/40",
                comment.status === "resolved" && "opacity-60",
              )}
            >
              <CommentRow
                comment={comment}
                name={displayName(comment)}
                seekTo={seekTo}
                canModerate={canModerate}
                onResolve={() =>
                  resolveComment.mutate({
                    commentId: comment.id,
                    resolved: comment.status !== "resolved",
                  })
                }
                onDelete={() => setDeleteTarget(comment.id)}
                onReply={() => {
                  setReplyTo((prev) => (prev === comment.id ? null : comment.id));
                  setReplyBody("");
                }}
              />
              {/* Replies */}
              {repliesFor(comment.id).map((reply) => (
                <div key={reply.id} className="ml-9 mt-2 border-l-2 border-border pl-3">
                  <CommentRow
                    comment={reply}
                    name={displayName(reply)}
                    seekTo={seekTo}
                    canModerate={canModerate}
                    onDelete={() => setDeleteTarget(reply.id)}
                  />
                </div>
              ))}
              {/* Reply composer */}
              {replyTo === comment.id && (
                <div className="ml-9 mt-2 space-y-2">
                  {needsGuestName && (
                    <Input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Your name"
                      aria-label="Your name"
                      className="h-8 text-sm"
                      maxLength={80}
                    />
                  )}
                  <Textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        submitComment(comment.id);
                      }
                    }}
                    placeholder={`Reply to ${displayName(comment)}…`}
                    rows={2}
                    autoFocus
                    className="min-h-14 resize-none text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => submitComment(comment.id)}
                      disabled={!replyBody.trim() || createComment.isPending}
                    >
                      Reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              The comment and its replies will be removed for everyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteComment.mutate({ commentId: deleteTarget });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CommentRow({
  comment,
  name,
  seekTo,
  canModerate,
  onResolve,
  onDelete,
  onReply,
}: {
  comment: WatchComment;
  name: string;
  seekTo: (ms: number) => void;
  canModerate: boolean;
  onResolve?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
}) {
  return (
    <div className="group/comment flex gap-2.5">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={comment.author?.avatarUrl ?? undefined} alt={name} />
        <AvatarFallback className="text-[10px]">{getInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
          </span>
          {comment.status === "resolved" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" /> Resolved
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm">
          {comment.timestampMs !== null && (
            <button
              type="button"
              onClick={() => seekTo(comment.timestampMs ?? 0)}
              className="mr-1.5 inline-flex items-center rounded bg-accent px-1.5 py-0.5 text-xs font-medium tabular-nums text-accent-foreground hover:bg-accent/80"
            >
              {formatDuration(comment.timestampMs)}
            </button>
          )}
          <span className="whitespace-pre-wrap break-words">{comment.body}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover/comment:opacity-100">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Reply className="h-3 w-3" /> Reply
            </button>
          )}
          {canModerate && onResolve && (
            <button
              type="button"
              onClick={onResolve}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {comment.status === "resolved" ? (
                <>
                  <Undo2 className="h-3 w-3" /> Reopen
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </>
              )}
            </button>
          )}
          {canModerate && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
