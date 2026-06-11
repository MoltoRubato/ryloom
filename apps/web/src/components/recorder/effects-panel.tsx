"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BG_PRESETS,
  FRAME_GRADIENT_STOPS,
  FRAME_PRESETS,
  type CornersId,
  type PaddingId,
  type RecorderEffects,
} from "@/lib/recorder/effects";
import { cn } from "@/lib/utils";

const PADDINGS: Array<{ id: PaddingId; label: string }> = [
  { id: "none", label: "None" },
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
];

const CORNERS: Array<{ id: CornersId; label: string }> = [
  { id: "rounded", label: "Rounded" },
  { id: "square", label: "Square" },
];

/**
 * Effects panel — a web port of the desktop overlay (index.html Effects):
 * Backgrounds (gradient wallpapers behind an inset screen), Frames (camera
 * bubble style) and Canvas (padding + corners, applied when a background is
 * active). Effects apply live, including mid-recording.
 */
export function EffectsPanel({
  open,
  onOpenChange,
  effects,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effects: RecorderEffects;
  onChange: (patch: Partial<RecorderEffects>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-w-md">
        <DialogHeader>
          <DialogTitle>Effects</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="backgrounds">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="backgrounds">Backgrounds</TabsTrigger>
            <TabsTrigger value="frames">Frames</TabsTrigger>
            <TabsTrigger value="canvas">Canvas</TabsTrigger>
          </TabsList>

          <TabsContent value="backgrounds" className="mt-4">
            <div className="grid grid-cols-3 gap-2">
              {BG_PRESETS.map((preset) => {
                const selected = effects.background === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({ background: preset.id })}
                    className={cn(
                      "flex h-16 flex-col items-center justify-end rounded-lg border p-1.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/40",
                    )}
                    style={preset.css ? { backgroundImage: preset.css } : undefined}
                    aria-pressed={selected}
                  >
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        preset.css ? "bg-black/50 text-white" : "text-muted-foreground",
                      )}
                    >
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Your screen is inset over the wallpaper with padding and a soft shadow.
            </p>
          </TabsContent>

          <TabsContent value="frames" className="mt-4">
            <div className="grid grid-cols-4 gap-2">
              {FRAME_PRESETS.map((preset) => {
                const selected = effects.frame === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({ frame: preset.id })}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-3 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/40",
                    )}
                    aria-pressed={selected}
                  >
                    <span
                      className="h-9 w-9 bg-muted"
                      style={{
                        borderRadius: preset.id === "square" ? "22%" : "9999px",
                        ...(preset.id === "gradient"
                          ? {
                              border: "3px solid transparent",
                              background: `linear-gradient(#27242f, #27242f) padding-box, linear-gradient(135deg, ${FRAME_GRADIENT_STOPS[0]}, ${FRAME_GRADIENT_STOPS[1]}) border-box`,
                            }
                          : preset.id === "none"
                            ? {}
                            : { border: "3px solid rgba(255,255,255,0.85)" }),
                      }}
                    />
                    <span className="text-[11px] font-medium">{preset.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              How your camera bubble is framed in the recording.
            </p>
          </TabsContent>

          <TabsContent value="canvas" className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Padding</p>
              <div className="flex gap-2">
                {PADDINGS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({ padding: preset.id })}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      effects.padding === preset.id
                        ? "border-primary bg-accent ring-1 ring-primary"
                        : "border-border hover:border-primary/40",
                    )}
                    aria-pressed={effects.padding === preset.id}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Corners</p>
              <div className="flex gap-2">
                {CORNERS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({ corners: preset.id })}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      effects.corners === preset.id
                        ? "border-primary bg-accent ring-1 ring-primary"
                        : "border-border hover:border-primary/40",
                    )}
                    aria-pressed={effects.corners === preset.id}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Padding and corners apply when a background is active.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
