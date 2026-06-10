"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { List, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { type VideoChapter } from "@ryloom/db";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import { msToClock, parseClock } from "@/components/edit/types";

type ChapterRow = { key: number; clock: string; title: string };

type ChaptersCardProps = {
  videoId: string;
  chapters: VideoChapter[] | null;
  currentTimeMs: number;
  durationMs: number;
};

function rowsFromChapters(chapters: VideoChapter[] | null): ChapterRow[] {
  return (chapters ?? []).map((chapter, index) => ({
    key: index,
    clock: msToClock(chapter.startMs),
    title: chapter.title,
  }));
}

export function ChaptersCard({
  videoId,
  chapters,
  currentTimeMs,
  durationMs,
}: ChaptersCardProps) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [rows, setRows] = useState<ChapterRow[]>(() => rowsFromChapters(chapters));
  const nextKeyRef = useRef(rows.length);

  useEffect(() => {
    if (dirty) return;
    const fresh = rowsFromChapters(chapters);
    setRows(fresh);
    nextKeyRef.current = fresh.length;
  }, [chapters, dirty]);

  const update = api.video.update.useMutation({
    onSuccess: () => {
      toast.success("Chapters saved");
      setDirty(false);
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function addRow(clock: string) {
    if (rows.length >= 100) {
      toast.error("A video can have at most 100 chapters");
      return;
    }
    setDirty(true);
    setRows((prev) => [...prev, { key: nextKeyRef.current++, clock, title: "" }]);
  }

  function updateRow(key: number, patch: Partial<Pick<ChapterRow, "clock" | "title">>) {
    setDirty(true);
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: number) {
    setDirty(true);
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function handleSave() {
    const parsed: VideoChapter[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const title = row.title.trim();
      if (!title) {
        toast.error(`Chapter ${i + 1} needs a title`);
        return;
      }
      const startMs = parseClock(row.clock);
      if (startMs === null) {
        toast.error(`Chapter ${i + 1}: use mm:ss for the timestamp`);
        return;
      }
      if (durationMs > 0 && startMs > durationMs) {
        toast.error(`Chapter ${i + 1} starts after the video ends`);
        return;
      }
      parsed.push({ title, startMs });
    }
    parsed.sort((a, b) => a.startMs - b.startMs);
    update.mutate({ videoId, chapters: parsed.length > 0 ? parsed : null });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <List className="size-4 text-primary" />
          Chapters
        </CardTitle>
        <CardDescription>
          Break the video into sections viewers can jump between. Saved in time order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No chapters yet — add one below.
          </p>
        )}
        {rows.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <Input
              value={row.clock}
              aria-label={`Chapter ${index + 1} timestamp`}
              className="w-20 shrink-0 text-center tabular-nums"
              placeholder="0:00"
              onChange={(e) => updateRow(row.key, { clock: e.target.value })}
            />
            <Input
              value={row.title}
              aria-label={`Chapter ${index + 1} title`}
              maxLength={200}
              placeholder="Chapter title"
              onChange={(e) => updateRow(row.key, { title: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove chapter ${index + 1}`}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(row.key)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => addRow(msToClock(currentTimeMs))}
          >
            <Plus className="size-4" />
            Add at playhead ({msToClock(currentTimeMs)})
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => addRow("0:00")}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={update.isPending || !dirty}
          onClick={handleSave}
        >
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          Save chapters
        </Button>
      </CardFooter>
    </Card>
  );
}
