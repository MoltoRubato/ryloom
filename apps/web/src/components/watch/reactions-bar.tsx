"use client";

import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { normalizeReactions } from "@/components/watch/types";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"] as const;

export function ReactionsBar({
  videoId,
  shareToken,
  anonymousId,
  getCurrentTimeMs,
  onReacted,
  className,
}: {
  videoId: string;
  shareToken?: string;
  /** Anonymous viewer id, recorded for guests. */
  anonymousId?: string;
  getCurrentTimeMs: () => number;
  /** Called after a reaction is recorded (e.g. to track analytics). */
  onReacted?: (emoji: string, timestampMs: number) => void;
  className?: string;
}) {
  const utils = api.useUtils();
  const [popping, setPopping] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});

  const listQuery = api.reaction.list.useQuery({ videoId, shareToken });
  const reactions = normalizeReactions(listQuery.data);

  const addReaction = api.reaction.add.useMutation({
    onSuccess: () => {
      void utils.reaction.list.invalidate({ videoId, shareToken });
      setOptimistic({});
    },
    onError: (error) => {
      setOptimistic({});
      toast.error(error.message || "Couldn't add reaction");
    },
  });

  const counts = reactions.reduce<Record<string, number>>((acc, reaction) => {
    acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
    return acc;
  }, {});

  const handleReact = (emoji: string) => {
    const timestampMs = Math.max(0, Math.round(getCurrentTimeMs()));
    setPopping(emoji);
    window.setTimeout(() => setPopping((p) => (p === emoji ? null : p)), 350);
    setOptimistic((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + 1 }));
    addReaction.mutate({
      videoId,
      shareToken,
      emoji,
      timestampMs,
      anonymousId: anonymousId || undefined,
    });
    onReacted?.(emoji, timestampMs);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {REACTION_EMOJIS.map((emoji) => {
        const count = (counts[emoji] ?? 0) + (optimistic[emoji] ?? 0);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => handleReact(emoji)}
            aria-label={`React with ${emoji}`}
            className={cn(
              "group flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-primary/40 hover:bg-accent",
              count > 0 && "border-primary/30",
            )}
          >
            <span
              className={cn(
                "text-base leading-none transition-transform duration-300 group-hover:scale-110",
                popping === emoji && "scale-150",
              )}
            >
              {emoji}
            </span>
            {count > 0 && (
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
