"use client";

import { AppWindow, Camera, Mic, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type RecorderAcquireError } from "@/lib/recorder/engine";

const DEVICE_LABELS = {
  screen: "Screen sharing",
  camera: "Camera",
  microphone: "Microphone",
} as const;

const DEVICE_ICONS = {
  screen: AppWindow,
  camera: Camera,
  microphone: Mic,
} as const;

const PERMISSION_HINTS = {
  screen:
    "When the picker opens, choose the screen, window or tab you want to record, then press Share.",
  camera:
    "Click the camera icon in your browser's address bar and set this site to Allow, then try again.",
  microphone:
    "Click the microphone icon in your browser's address bar and set this site to Allow, then try again.",
} as const;

/**
 * Friendly retry modal shown when stream acquisition fails (permission
 * denied, device busy, device missing…).
 */
export function PermissionDialog({
  issue,
  onRetry,
  onClose,
}: {
  issue: RecorderAcquireError | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const Icon = issue ? DEVICE_ICONS[issue.device] : ShieldAlert;

  return (
    <Dialog
      open={issue !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="dark sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <Icon className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle>
            {issue
              ? `${DEVICE_LABELS[issue.device]} ${issue.kind === "permission" ? "needs your permission" : "isn't available"}`
              : "Something went wrong"}
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            {issue?.message ?? "We couldn't access your recording devices."}
          </DialogDescription>
        </DialogHeader>
        {issue?.kind === "permission" && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            {PERMISSION_HINTS[issue.device]}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
