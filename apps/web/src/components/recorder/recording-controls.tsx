"use client";

import { useState } from "react";
import { Mic, MicOff, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Floating control card shown while recording: pulsing status dot + timer,
 * pause/resume, mic mute, stop (primary), restart and cancel (confirmed).
 */
export function RecordingControls({
  elapsedMs,
  remainingMs,
  paused,
  micEnabled,
  hasMic,
  onTogglePause,
  onToggleMic,
  onStop,
  onRestart,
  onCancel,
}: {
  elapsedMs: number;
  remainingMs: number | null;
  paused: boolean;
  micEnabled: boolean;
  hasMic: boolean;
  onTogglePause: () => void;
  onToggleMic: () => void;
  onStop: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const lowTime = remainingMs !== null && remainingMs <= 60_000;

  return (
    <>
      <div className="fixed bottom-8 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-border bg-card/95 py-2.5 pr-2.5 pl-4 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2.5 pr-2">
          <span className="relative flex h-2.5 w-2.5">
            {!paused && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 rounded-full",
                paused ? "bg-amber-500" : "bg-red-500",
              )}
            />
          </span>
          <div className="min-w-14">
            <p className="text-sm font-semibold tabular-nums">{formatDuration(elapsedMs)}</p>
            {remainingMs !== null && (
              <p
                className={cn(
                  "text-[11px] leading-tight tabular-nums",
                  lowTime ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {formatDuration(Math.max(0, remainingMs))} left
              </p>
            )}
          </div>
        </div>

        <Separator orientation="vertical" className="h-7" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePause}
          title={paused ? "Resume recording" : "Pause recording"}
          aria-label={paused ? "Resume recording" : "Pause recording"}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>

        {hasMic && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMic}
            title={micEnabled ? "Mute microphone" : "Unmute microphone"}
            aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
            className={cn(!micEnabled && "text-destructive hover:text-destructive")}
          >
            {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
        )}

        <Button variant="destructive" size="sm" onClick={onStop} className="gap-2 px-4">
          <Square className="h-3.5 w-3.5 fill-current" />
          Stop
        </Button>

        <Separator orientation="vertical" className="h-7" />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirmRestart(true)}
          title="Restart recording"
          aria-label="Restart recording"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirmCancel(true)}
          title="Discard recording"
          aria-label="Discard recording"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Restart this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything captured so far ({formatDuration(elapsedMs)}) will be discarded and a
              fresh recording will start right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRestart(false);
                onRestart();
              }}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything captured so far ({formatDuration(elapsedMs)}) will be permanently
              discarded. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmCancel(false);
                onCancel();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
