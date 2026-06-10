"use client";

import { useRef, useState } from "react";
import { FileVideo, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * "Or upload a video file" drop zone — drag & drop or click to pick a file.
 * The parent runs the same createSession → TUS upload → completeSession flow
 * used for in-browser recordings.
 */
export function UploadFileCard({
  busy,
  onPickFile,
}: {
  busy: boolean;
  onPickFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith("video/")) {
      toast.error("Please choose a video file (MP4, WebM or MOV).");
      return;
    }
    if (file.size === 0) {
      toast.error("That file looks empty.");
      return;
    }
    onPickFile(file);
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  return (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      aria-label="Upload a video file"
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        if (busy) return;
        acceptFile(event.dataTransfer.files[0]);
      }}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border border-dashed p-5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging
          ? "border-primary bg-primary/10"
          : "border-border bg-card/40 hover:border-primary/50 hover:bg-accent/40",
        busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <FileVideo className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {busy ? "Preparing upload…" : "Or upload a video file"}
        </p>
        <p className="text-xs text-muted-foreground">
          Drag &amp; drop or click to browse — MP4, WebM or MOV
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          acceptFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
