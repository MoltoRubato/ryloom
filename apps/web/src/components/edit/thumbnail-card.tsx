"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/trpc/react";
import { FeatureGate } from "@/components/edit/feature-gate";

type ThumbnailCardProps = {
  videoId: string;
  workspaceId: string;
  enabled: boolean;
  thumbnailUrl: string | null;
  hasCustomThumbnail: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

type BusyAction = "capture" | "upload" | "remove" | null;

/** Encodes a drawable source to a JPEG blob at quality 0.85. */
async function encodeJpeg(
  source: HTMLVideoElement | ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new Error("Could not encode the image");
  return blob;
}

export function ThumbnailCard({
  videoId,
  workspaceId,
  enabled,
  thumbnailUrl,
  hasCustomThumbnail,
  videoRef,
}: ThumbnailCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);

  const setCustomThumbnail = api.video.setCustomThumbnail.useMutation();

  async function uploadAndSet(blob: Blob) {
    const supabase = createClient();
    const storagePath = `workspaces/${workspaceId}/videos/${videoId}/thumbs/custom-${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("thumbnails")
      .upload(storagePath, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);
    await setCustomThumbnail.mutateAsync({ videoId, storagePath });
    toast.success("Thumbnail updated");
    router.refresh();
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      toast.error("Load the video preview first, then pick a frame");
      return;
    }
    setBusy("capture");
    try {
      const blob = await encodeJpeg(video, video.videoWidth, video.videoHeight);
      await uploadAndSet(blob);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't capture a frame from this video",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    setBusy("upload");
    try {
      const bitmap = await createImageBitmap(file);
      const blob = await encodeJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      await uploadAndSet(blob);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't process that image");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await setCustomThumbnail.mutateAsync({ videoId, storagePath: null });
      toast.success("Custom thumbnail removed");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the thumbnail");
    } finally {
      setBusy(null);
    }
  }

  return (
    <FeatureGate
      enabled={enabled}
      feature="customThumbnails"
      label="Custom thumbnails"
      workspaceId={workspaceId}
    >
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <ImageIcon className="size-4 text-primary" />
              Thumbnail
            </span>
            {hasCustomThumbnail && <Badge variant="secondary">Custom</Badge>}
          </CardTitle>
          <CardDescription>
            Pick the exact frame viewers see before they press play.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Current thumbnail"
              className="aspect-video w-full rounded-lg border border-border bg-muted object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/50">
              <ImageIcon className="size-8 text-muted-foreground" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void handleCapture()}
            >
              {busy === "capture" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
              Capture frame
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy === "upload" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Upload image
            </Button>
          </div>

          {hasCustomThumbnail && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground hover:text-destructive"
              disabled={busy !== null}
              onClick={() => void handleRemove()}
            >
              {busy === "remove" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Remove custom thumbnail
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFile(e)}
          />
        </CardContent>
      </Card>
    </FeatureGate>
  );
}
