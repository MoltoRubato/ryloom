"use client";

import { formatDistanceToNow } from "date-fns";
import { History, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type RecoverySession } from "@/lib/recorder/recovery";

/**
 * Shown on the setup screen when IndexedDB holds chunks from recordings that
 * never finished (tab crash, accidental close). Offers resume or discard.
 */
export function RecoveryBanner({
  sessions,
  busy,
  onResume,
  onDiscard,
}: {
  sessions: RecoverySession[];
  busy: boolean;
  onResume: (session: RecoverySession) => void;
  onDiscard: (session: RecoverySession) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/20">
          <History className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {sessions.length === 1
              ? "We found an unfinished recording"
              : `We found ${sessions.length} unfinished recordings`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A previous recording didn&apos;t finish uploading — you can recover it or discard it.
          </p>
          <ul className="mt-3 space-y-2">
            {sessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {session.title || "Untitled recording"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" disabled={busy} onClick={() => onResume(session)}>
                    Recover
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onDiscard(session)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Discard recovered recording"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
