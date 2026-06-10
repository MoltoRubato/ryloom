"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { type VideoCta } from "@ryloom/db";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { msToClock, parseClock } from "@/components/edit/types";

const SWATCHES = [
  "#625DF5",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#171717",
] as const;

type CtaCardProps = {
  videoId: string;
  cta: VideoCta | null;
  currentTimeMs: number;
  durationMs: number;
};

export function CtaCard({ videoId, cta, currentTimeMs, durationMs }: CtaCardProps) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [label, setLabel] = useState(cta?.label ?? "");
  const [url, setUrl] = useState(cta?.url ?? "");
  const [color, setColor] = useState(cta?.color ?? SWATCHES[0]);
  const [timing, setTiming] = useState<"always" | "timestamp">(
    cta?.showAtMs != null ? "timestamp" : "always",
  );
  const [showAtClock, setShowAtClock] = useState(
    cta?.showAtMs != null ? msToClock(cta.showAtMs) : "0:00",
  );

  // Sync from the server after a refresh, but never clobber in-progress edits.
  useEffect(() => {
    if (dirty) return;
    setLabel(cta?.label ?? "");
    setUrl(cta?.url ?? "");
    setColor(cta?.color ?? SWATCHES[0]);
    setTiming(cta?.showAtMs != null ? "timestamp" : "always");
    setShowAtClock(cta?.showAtMs != null ? msToClock(cta.showAtMs) : "0:00");
  }, [cta, dirty]);

  const update = api.video.update.useMutation({
    onSuccess: () => {
      setDirty(false);
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function handleSave() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      toast.error("Add a button label");
      return;
    }
    let normalizedUrl = url.trim();
    if (!normalizedUrl) {
      toast.error("Add a destination URL");
      return;
    }
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
    try {
      new URL(normalizedUrl);
    } catch {
      toast.error("Enter a valid URL");
      return;
    }

    let showAtMs: number | null = null;
    if (timing === "timestamp") {
      const ms = parseClock(showAtClock);
      if (ms === null) {
        toast.error("Use mm:ss for the show-at time");
        return;
      }
      if (durationMs > 0 && ms > durationMs) {
        toast.error("The show-at time is beyond the end of the video");
        return;
      }
      showAtMs = ms;
    }

    update.mutate(
      { videoId, cta: { label: trimmedLabel, url: normalizedUrl, color, showAtMs } },
      { onSuccess: () => toast.success("Call to action saved") },
    );
  }

  function handleRemove() {
    update.mutate(
      { videoId, cta: null },
      {
        onSuccess: () => {
          toast.success("Call to action removed");
          setDirty(false);
          setLabel("");
          setUrl("");
        },
      },
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" />
          Call to action
        </CardTitle>
        <CardDescription>
          Show a button on the player that sends viewers anywhere — a doc, a signup page,
          your calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`cta-label-${videoId}`}>Button label</Label>
          <Input
            id={`cta-label-${videoId}`}
            value={label}
            maxLength={80}
            placeholder="Book a demo"
            onChange={(e) => {
              setDirty(true);
              setLabel(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cta-url-${videoId}`}>URL</Label>
          <Input
            id={`cta-url-${videoId}`}
            value={url}
            inputMode="url"
            placeholder="https://example.com/demo"
            onChange={(e) => {
              setDirty(true);
              setUrl(e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Color</Label>
          <div className="flex items-center gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use color ${swatch}`}
                onClick={() => {
                  setDirty(true);
                  setColor(swatch);
                }}
                className={cn(
                  "size-6 rounded-full border border-border transition-transform hover:scale-110",
                  color === swatch && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Show</Label>
            <Select
              value={timing}
              onValueChange={(value) => {
                setDirty(true);
                setTiming(value === "timestamp" ? "timestamp" : "always");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="When to show" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">On pause / end</SelectItem>
                <SelectItem value="timestamp">At a timestamp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {timing === "timestamp" && (
            <div className="space-y-1.5">
              <Label htmlFor={`cta-showat-${videoId}`}>At (mm:ss)</Label>
              <div className="flex gap-1.5">
                <Input
                  id={`cta-showat-${videoId}`}
                  value={showAtClock}
                  className="tabular-nums"
                  placeholder="1:30"
                  onChange={(e) => {
                    setDirty(true);
                    setShowAtClock(e.target.value);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setDirty(true);
                    setShowAtClock(msToClock(currentTimeMs));
                  }}
                >
                  Playhead
                </Button>
              </div>
            </div>
          )}
        </div>

        {label.trim() && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-2 text-xs text-muted-foreground">Preview</p>
            <span
              className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {label.trim()}
            </span>
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button className="flex-1" disabled={update.isPending} onClick={handleSave}>
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          {cta ? "Update CTA" : "Add CTA"}
        </Button>
        {cta && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove call to action"
            className="text-muted-foreground hover:text-destructive"
            disabled={update.isPending}
            onClick={handleRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
