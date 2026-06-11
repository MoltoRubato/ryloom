/**
 * Recording effects — shared by the engine's canvas compositor and the
 * effects panel UI. Ported 1:1 from the desktop app (apps/desktop/src/
 * renderer/recorder.js BACKGROUND_PAINTERS + app.js BG_PRESETS/FRAME_PRESETS)
 * so a recording looks identical no matter which client made it.
 */

export type BackgroundId =
  | "none"
  | "aurora"
  | "sunset"
  | "ocean"
  | "candy"
  | "forest"
  | "slate"
  | "graphite"
  | "lavender";

export type PaddingId = "none" | "sm" | "md" | "lg";

export type CornersId = "rounded" | "square";

export type BubbleFrame = "circle" | "gradient" | "square" | "none";

export type RecorderEffects = {
  background: BackgroundId;
  padding: PaddingId;
  corners: CornersId;
  frame: BubbleFrame;
};

export const DEFAULT_EFFECTS: RecorderEffects = {
  background: "none",
  padding: "md",
  corners: "rounded",
  frame: "circle",
};

/** Padding presets (Effects → Canvas) as a fraction of the short edge. */
export const PADDING_FRACTIONS: Record<PaddingId, number> = {
  none: 0,
  sm: 0.035,
  md: 0.06,
  lg: 0.095,
};

/** Swatch previews for the effects panel — ids must match the painters. */
export const BG_PRESETS: Array<{ id: BackgroundId; label: string; css: string | null }> = [
  { id: "none", label: "None", css: null },
  { id: "aurora", label: "Aurora", css: "linear-gradient(135deg,#16102e,#4636b3 60%,#2c8f6e)" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(135deg,#ff7e5f,#feb47b)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(180deg,#0f2027,#203a43,#2c5364)" },
  { id: "candy", label: "Candy", css: "linear-gradient(135deg,#fc5c7d,#6a82fb)" },
  { id: "forest", label: "Forest", css: "linear-gradient(135deg,#0b3d2e,#1d976c)" },
  { id: "slate", label: "Slate", css: "linear-gradient(135deg,#1f1c2c,#4e54c8)" },
  { id: "graphite", label: "Graphite", css: "linear-gradient(180deg,#1b1924,#2e2b3a)" },
  { id: "lavender", label: "Lavender", css: "linear-gradient(135deg,#b993d6,#8ca6db)" },
];

export const FRAME_PRESETS: Array<{ id: BubbleFrame; label: string }> = [
  { id: "circle", label: "Classic" },
  { id: "gradient", label: "Gradient" },
  { id: "square", label: "Square" },
  { id: "none", label: "Borderless" },
];

/** The gradient ring frame (Effects → Frames → Gradient). */
export const FRAME_GRADIENT_STOPS: readonly [string, string] = ["#7a76ff", "#3ecf8e"];

function paintGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export const BACKGROUND_PAINTERS: Partial<Record<BackgroundId, Painter>> = {
  aurora(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#16102e");
    base.addColorStop(1, "#2c1f5e");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.22, h * 0.18, Math.max(w, h) * 0.5, "rgba(98, 93, 245, 0.5)");
    paintGlow(ctx, w * 0.85, h * 0.85, Math.max(w, h) * 0.45, "rgba(62, 207, 142, 0.32)");
  },
  sunset(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#ff7e5f");
    base.addColorStop(1, "#feb47b");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.8, h * 0.15, Math.max(w, h) * 0.5, "rgba(255, 94, 158, 0.45)");
  },
  ocean(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#0f2027");
    base.addColorStop(0.5, "#203a43");
    base.addColorStop(1, "#2c5364");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.75, h * 0.25, Math.max(w, h) * 0.45, "rgba(64, 196, 255, 0.3)");
  },
  candy(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#fc5c7d");
    base.addColorStop(1, "#6a82fb");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  forest(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#0b3d2e");
    base.addColorStop(1, "#1d976c");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    paintGlow(ctx, w * 0.2, h * 0.8, Math.max(w, h) * 0.5, "rgba(56, 239, 125, 0.28)");
  },
  slate(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#1f1c2c");
    base.addColorStop(1, "#4e54c8");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  graphite(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#1b1924");
    base.addColorStop(1, "#2e2b3a");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
  lavender(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#b993d6");
    base.addColorStop(1, "#8ca6db");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  },
};
