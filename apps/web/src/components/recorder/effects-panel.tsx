"use client";

import { useEffect, useRef } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CANVAS_BACKGROUND_PAINTERS,
  CANVAS_BACKGROUND_PRESETS,
  CANVAS_LAYOUTS,
  CANVAS_LAYOUT_PRESETS,
  CANVAS_TEMPLATES,
  type CanvasLayoutId,
  type CanvasScene,
  type CanvasTemplate,
} from "@/lib/recorder/canvas-scene";
import {
  CAMERA_BG_PRESETS,
  FRAME_GRADIENT_STOPS,
  FRAME_PRESETS,
  type CornersId,
  type PaddingId,
  type RecorderEffects,
} from "@/lib/recorder/effects";
import { type RecordingMode } from "@/lib/recorder/engine";
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
 * Effects panel:
 *  - Backgrounds — your CAMERA's background: Clear (real room), Blur, or a
 *    replacement, via live person segmentation. Applies mid-recording.
 *  - Frames — camera bubble framing.
 *  - Canvas — a Loom-style designed backdrop: templates, backgrounds and
 *    editable text layouts. In camera mode the canvas is the recording;
 *    in screen modes its background becomes the wallpaper your screen is
 *    inset on (padding + corners below).
 */
export function EffectsPanel({
  open,
  onOpenChange,
  effects,
  onChange,
  canvasScene,
  onCanvasChange,
  onApplyTemplate,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effects: RecorderEffects;
  onChange: (patch: Partial<RecorderEffects>) => void;
  canvasScene: CanvasScene;
  onCanvasChange: (scene: CanvasScene) => void;
  onApplyTemplate: (template: CanvasTemplate) => void;
  mode: RecordingMode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[85vh] max-w-md overflow-y-auto">
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
              {CAMERA_BG_PRESETS.map((preset) => {
                const selected = effects.cameraBackground === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({ cameraBackground: preset.id })}
                    className={cn(
                      "relative flex h-16 flex-col items-center justify-end overflow-hidden rounded-lg border p-1.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/40",
                    )}
                    style={preset.css ? { backgroundImage: preset.css } : undefined}
                    aria-pressed={selected}
                  >
                    {preset.id === "blur" && <BlurSwatch />}
                    <span
                      className={cn(
                        "relative rounded px-1.5 py-0.5 text-[11px] font-medium",
                        preset.id === "none" ? "text-muted-foreground" : "bg-black/50 text-white",
                      )}
                    >
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {mode === "screen"
                ? "Backgrounds change what's behind you on camera — pick a mode with the camera to use them."
                : "What's behind you on camera: Clear keeps your real background, Blur softens it, the rest replace it. Switches live, even mid-recording."}
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

          <TabsContent value="canvas" className="mt-4 space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">Templates</p>
              <div className="grid grid-cols-4 gap-2">
                {CANVAS_TEMPLATES.map((template) => {
                  const selected = template.preset
                    ? canvasScene.enabled && canvasScene.template === template.id
                    : !canvasScene.enabled;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => onApplyTemplate(template)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary ring-1 ring-primary"
                          : "border-border hover:border-primary/40",
                      )}
                      aria-pressed={selected}
                    >
                      {template.preset ? (
                        <PainterPreview
                          painterId={template.preset.background}
                          className="h-10 w-full rounded-md"
                        />
                      ) : (
                        <span className="flex h-10 w-full items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                          Off
                        </span>
                      )}
                      <span className="text-[11px] font-medium">{template.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Backgrounds</p>
              <div className="grid grid-cols-3 gap-2">
                {CANVAS_BACKGROUND_PRESETS.map((preset) => {
                  const selected = canvasScene.enabled && canvasScene.background === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onCanvasChange({
                          ...canvasScene,
                          enabled: true,
                          background: preset.id,
                        })
                      }
                      className={cn(
                        "relative flex h-14 flex-col items-center justify-end overflow-hidden rounded-lg border p-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary ring-1 ring-primary"
                          : "border-border hover:border-primary/40",
                      )}
                      aria-pressed={selected}
                    >
                      <PainterPreview painterId={preset.id} className="absolute inset-0" />
                      <span className="relative rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Text layouts</p>
              <div className="grid grid-cols-3 gap-2">
                {CANVAS_LAYOUT_PRESETS.map((preset) => {
                  const selected = canvasScene.enabled && canvasScene.layout === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onCanvasChange({
                          ...canvasScene,
                          enabled: true,
                          layout: preset.id,
                        })
                      }
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary ring-1 ring-primary"
                          : "border-border hover:border-primary/40",
                      )}
                      aria-pressed={selected}
                    >
                      <LayoutPreview layout={preset.id} />
                      <span className="text-[11px] font-medium">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-2 text-sm font-medium">Padding</p>
                <div className="flex gap-1.5">
                  {PADDINGS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onChange({ padding: preset.id })}
                      className={cn(
                        "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                <div className="flex gap-1.5">
                  {CORNERS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onChange({ corners: preset.id })}
                      className={cn(
                        "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            </div>

            <p className="text-xs text-muted-foreground">
              {mode === "camera"
                ? "The canvas is your backdrop — click any text on it to edit, and your camera floats on top. Pick \"None\" to go back to full-screen camera."
                : "In screen modes the canvas background becomes the wallpaper your screen is inset on (padding + corners above). Turn it on before you hit record."}
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Mocked blurred-room swatch for the Blur preset. */
function BlurSwatch() {
  return (
    <span
      aria-hidden
      className="absolute inset-0"
      style={{ background: "linear-gradient(135deg, #2b3040, #15171f)" }}
    >
      <span
        className="absolute rounded-full"
        style={{ left: "18%", top: "20%", width: 18, height: 18, background: "#7a76ff", filter: "blur(7px)" }}
      />
      <span
        className="absolute rounded-full"
        style={{ right: "16%", top: "38%", width: 14, height: 14, background: "#3ecf8e", filter: "blur(7px)" }}
      />
      <span
        className="absolute rounded-full"
        style={{ left: "42%", bottom: "18%", width: 16, height: 16, background: "#feb47b", filter: "blur(8px)" }}
      />
    </span>
  );
}

/** Paints a canvas-scene background into a small live preview. */
function PainterPreview({
  painterId,
  className,
}: {
  painterId: keyof typeof CANVAS_BACKGROUND_PAINTERS;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    CANVAS_BACKGROUND_PAINTERS[painterId](ctx, canvas.width, canvas.height);
  }, [painterId]);

  return <canvas ref={ref} className={cn("h-full w-full object-cover", className)} />;
}

/** Schematic preview of a text layout, derived from the real slot geometry. */
function LayoutPreview({ layout }: { layout: CanvasLayoutId }) {
  const slots = CANVAS_LAYOUTS[layout];
  return (
    <span className="relative block aspect-video w-full overflow-hidden rounded-md bg-muted/60">
      {slots.map((slot) => (
        <span
          key={slot.key}
          className="absolute rounded-[1px] bg-foreground/55"
          style={{
            left: `${(slot.x + (slot.align === "center" ? slot.w * 0.2 : 0)) * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.w * (slot.align === "center" ? 0.6 : slot.key === "heading" ? 0.85 : 0.7) * 100}%`,
            height: `${Math.max(6, slot.size * 160)}%`,
          }}
        />
      ))}
      {slots.length === 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground">
          No text
        </span>
      )}
    </span>
  );
}
