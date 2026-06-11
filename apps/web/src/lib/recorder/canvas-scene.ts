/**
 * Canvas (Effects → Canvas) — a Loom-style customizable recording backdrop.
 *
 * A canvas is a full-frame designed page: a painted background, an editable
 * text layout, and your camera bubble on top. Pick a template (or compose a
 * background + text layout yourself), click any text on the stage to edit it,
 * and talk over it. In camera mode the canvas IS the recording; in screen
 * modes the canvas background doubles as the wallpaper your screen is inset
 * on (padding + corners from the effects panel).
 *
 * Everything here is shared by the DOM stage (canvas-stage.tsx — what the
 * presenter sees and edits) and the engine compositor (paintCanvasScene —
 * what viewers get), so the two stay pixel-faithful: same painters, same
 * normalized slot geometry, same width-relative type scale.
 */

export type CanvasTemplateId =
  | "none"
  | "meeting"
  | "standup"
  | "celebration"
  | "news"
  | "intro"
  | "bubble";

export type CanvasBackgroundId =
  | "gradient"
  | "rainbow"
  | "paint"
  | "splash"
  | "geometric"
  | "flowers";

export type CanvasLayoutId =
  | "empty"
  | "centered"
  | "slide-one"
  | "slide-two"
  | "short-list"
  | "long-list";

export type CanvasScene = {
  enabled: boolean;
  /** Last template applied — purely for highlighting in the picker. */
  template: CanvasTemplateId;
  background: CanvasBackgroundId;
  layout: CanvasLayoutId;
  /** Editable copy, keyed by slot key (heading / subheading / body / item-N). */
  texts: Record<string, string>;
};

export const DEFAULT_CANVAS_SCENE: CanvasScene = {
  enabled: false,
  template: "none",
  background: "gradient",
  layout: "empty",
  texts: {},
};

// ---------------------------------------------------------------------------
// Text layouts — normalized slot geometry shared by DOM stage + compositor.
// ---------------------------------------------------------------------------

export type CanvasSlot = {
  key: string;
  /** Normalized box: x/w as fractions of stage width, y of stage height. */
  x: number;
  y: number;
  w: number;
  align: "left" | "center";
  /** Font size as a fraction of stage WIDTH (so DOM vw === canvas w * size). */
  size: number;
  weight: 400 | 600 | 800;
  lineHeight: number;
  bullet?: boolean;
  placeholder: string;
};

export const CANVAS_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const heading = (overrides: Partial<CanvasSlot>): CanvasSlot => ({
  key: "heading",
  x: 0.08,
  y: 0.18,
  w: 0.8,
  align: "left",
  size: 0.052,
  weight: 800,
  lineHeight: 1.15,
  placeholder: "Add a title",
  ...overrides,
});

export const CANVAS_LAYOUTS: Record<CanvasLayoutId, CanvasSlot[]> = {
  empty: [],
  centered: [
    heading({ x: 0.1, w: 0.8, y: 0.38, align: "center", size: 0.064 }),
    {
      key: "subheading",
      x: 0.18,
      y: 0.55,
      w: 0.64,
      align: "center",
      size: 0.026,
      weight: 400,
      lineHeight: 1.4,
      placeholder: "Add a subtitle",
    },
  ],
  "slide-one": [
    heading({ y: 0.3, w: 0.64, size: 0.058 }),
    {
      key: "body",
      x: 0.08,
      y: 0.47,
      w: 0.5,
      align: "left",
      size: 0.024,
      weight: 400,
      lineHeight: 1.5,
      placeholder: "Add supporting detail",
    },
  ],
  "slide-two": [
    {
      key: "subheading",
      x: 0.08,
      y: 0.2,
      w: 0.6,
      align: "left",
      size: 0.021,
      weight: 600,
      lineHeight: 1.3,
      placeholder: "Add a kicker",
    },
    heading({ y: 0.26, w: 0.72, size: 0.06 }),
    {
      key: "body",
      x: 0.08,
      y: 0.76,
      w: 0.56,
      align: "left",
      size: 0.022,
      weight: 400,
      lineHeight: 1.45,
      placeholder: "Add a closing line",
    },
  ],
  "short-list": [
    heading({ y: 0.15, size: 0.048 }),
    ...[0, 1, 2].map<CanvasSlot>((i) => ({
      key: `item-${i}`,
      x: 0.1,
      y: 0.36 + i * 0.13,
      w: 0.62,
      align: "left",
      size: 0.029,
      weight: 600,
      lineHeight: 1.3,
      bullet: true,
      placeholder: `List item ${i + 1}`,
    })),
  ],
  "long-list": [
    heading({ y: 0.11, size: 0.044 }),
    ...[0, 1, 2, 3, 4, 5].map<CanvasSlot>((i) => ({
      key: `item-${i}`,
      x: 0.1,
      y: 0.26 + i * 0.108,
      w: 0.66,
      align: "left",
      size: 0.023,
      weight: 600,
      lineHeight: 1.3,
      bullet: true,
      placeholder: `List item ${i + 1}`,
    })),
  ],
};

export const CANVAS_LAYOUT_PRESETS: Array<{ id: CanvasLayoutId; label: string }> = [
  { id: "empty", label: "Empty" },
  { id: "centered", label: "Centered" },
  { id: "slide-one", label: "Slide One" },
  { id: "slide-two", label: "Slide Two" },
  { id: "short-list", label: "Short List" },
  { id: "long-list", label: "Long List" },
];

// ---------------------------------------------------------------------------
// Backgrounds — deterministic full-frame painters (DOM stage + compositor).
// ---------------------------------------------------------------------------

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export const CANVAS_BACKGROUND_PRESETS: Array<{
  id: CanvasBackgroundId;
  label: string;
  /** Whether the background wants light (white) or dark text on top. */
  ink: "light" | "dark";
}> = [
  { id: "gradient", label: "Gradient", ink: "light" },
  { id: "rainbow", label: "Rainbow", ink: "light" },
  { id: "paint", label: "Paint", ink: "dark" },
  { id: "splash", label: "Splash", ink: "light" },
  { id: "geometric", label: "Geometric", ink: "light" },
  { id: "flowers", label: "Flowers", ink: "dark" },
];

export function canvasInkColor(background: CanvasBackgroundId): string {
  const preset = CANVAS_BACKGROUND_PRESETS.find((p) => p.id === background);
  return preset?.ink === "dark" ? "#241f33" : "#ffffff";
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(0.75, color);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function flower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  petal: string,
  center: string,
  rotation = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.62, size * 0.34, size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const CANVAS_BACKGROUND_PAINTERS: Record<CanvasBackgroundId, Painter> = {
  gradient(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#3b2f8f");
    base.addColorStop(0.5, "#7c3aed");
    base.addColorStop(1, "#d6456e");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.85, h * 0.1, Math.max(w, h) * 0.55, "rgba(251, 191, 36, 0.35)");
    glow(ctx, w * 0.1, h * 0.9, Math.max(w, h) * 0.5, "rgba(56, 189, 248, 0.28)");
  },
  rainbow(ctx, w, h) {
    const base = ctx.createLinearGradient(0, h, w, 0);
    base.addColorStop(0, "#e85d75");
    base.addColorStop(0.2, "#f2a25c");
    base.addColorStop(0.4, "#e8c95c");
    base.addColorStop(0.6, "#4fae72");
    base.addColorStop(0.8, "#4a90d9");
    base.addColorStop(1, "#8d6cc8");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.5, h * 0.05, Math.max(w, h) * 0.7, "rgba(255,255,255,0.22)");
    glow(ctx, w * 0.5, h * 1.05, Math.max(w, h) * 0.6, "rgba(30, 20, 60, 0.25)");
  },
  paint(ctx, w, h) {
    ctx.fillStyle = "#f4efe7";
    ctx.fillRect(0, 0, w, h);
    const s = Math.max(w, h);
    blob(ctx, w * 0.88, h * 0.16, s * 0.2, "rgba(244, 162, 89, 0.85)");
    blob(ctx, w * 0.12, h * 0.85, s * 0.24, "rgba(118, 169, 220, 0.8)");
    blob(ctx, w * 0.78, h * 0.86, s * 0.16, "rgba(214, 116, 152, 0.8)");
    blob(ctx, w * 0.06, h * 0.12, s * 0.13, "rgba(122, 188, 159, 0.8)");
    blob(ctx, w * 0.94, h * 0.55, s * 0.09, "rgba(196, 154, 220, 0.75)");
  },
  splash(ctx, w, h) {
    ctx.fillStyle = "#0c1026";
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.82, h * 0.2, Math.max(w, h) * 0.45, "rgba(34, 211, 238, 0.4)");
    glow(ctx, w * 0.15, h * 0.78, Math.max(w, h) * 0.45, "rgba(232, 121, 249, 0.35)");
    glow(ctx, w * 0.55, h * 1.0, Math.max(w, h) * 0.35, "rgba(163, 230, 53, 0.22)");
    // Deterministic ink-splatter dots.
    const dots: Array<[number, number, number, string]> = [
      [0.7, 0.12, 0.012, "rgba(34, 211, 238, 0.8)"],
      [0.9, 0.32, 0.008, "rgba(34, 211, 238, 0.6)"],
      [0.78, 0.4, 0.005, "rgba(125, 211, 252, 0.7)"],
      [0.24, 0.62, 0.01, "rgba(232, 121, 249, 0.7)"],
      [0.08, 0.58, 0.006, "rgba(232, 121, 249, 0.55)"],
      [0.3, 0.88, 0.008, "rgba(240, 171, 252, 0.6)"],
      [0.5, 0.85, 0.005, "rgba(163, 230, 53, 0.6)"],
      [0.62, 0.93, 0.009, "rgba(163, 230, 53, 0.45)"],
    ];
    for (const [dx, dy, dr, color] of dots) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(w * dx, h * dy, Math.max(2, w * dr), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  geometric(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#141722");
    base.addColorStop(1, "#1d2233");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    // Outlined circle, top-right.
    ctx.strokeStyle = "rgba(98, 93, 245, 0.55)";
    ctx.lineWidth = Math.max(2, s * 0.012);
    ctx.beginPath();
    ctx.arc(w * 0.86, h * 0.18, s * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    // Filled triangle, bottom-left.
    ctx.fillStyle = "rgba(62, 207, 142, 0.3)";
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.94);
    ctx.lineTo(w * 0.24, h * 0.94);
    ctx.lineTo(w * 0.15, h * 0.68);
    ctx.closePath();
    ctx.fill();
    // Rotated square, mid-right.
    ctx.save();
    ctx.translate(w * 0.92, h * 0.72);
    ctx.rotate(Math.PI / 5);
    ctx.fillStyle = "rgba(255, 176, 32, 0.28)";
    ctx.fillRect(-s * 0.09, -s * 0.09, s * 0.18, s * 0.18);
    ctx.restore();
    // Dotted arc, top-left.
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    for (let i = 0; i < 7; i++) {
      const angle = Math.PI * 0.55 + i * 0.16;
      ctx.beginPath();
      ctx.arc(
        w * 0.12 + Math.cos(angle) * s * 0.22,
        h * 0.1 + Math.sin(angle) * s * 0.22,
        Math.max(2, s * 0.007),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  },
  flowers(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#fdeef0");
    base.addColorStop(1, "#f3e8fb");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    flower(ctx, w * 0.9, h * 0.14, s * 0.11, "rgba(244, 114, 158, 0.5)", "rgba(251, 191, 36, 0.75)", 0.3);
    flower(ctx, w * 0.08, h * 0.84, s * 0.14, "rgba(167, 139, 250, 0.45)", "rgba(244, 114, 158, 0.7)", 0.9);
    flower(ctx, w * 0.8, h * 0.85, s * 0.08, "rgba(110, 191, 156, 0.5)", "rgba(255, 255, 255, 0.9)", 1.7);
    flower(ctx, w * 0.06, h * 0.12, s * 0.06, "rgba(251, 146, 60, 0.45)", "rgba(255, 255, 255, 0.9)", 2.4);
    flower(ctx, w * 0.62, h * 0.06, s * 0.045, "rgba(167, 139, 250, 0.4)", "rgba(251, 191, 36, 0.6)", 0);
  },
};

// ---------------------------------------------------------------------------
// Templates — one-tap presets (background + layout + starter copy).
// ---------------------------------------------------------------------------

export type CanvasTemplate = {
  id: CanvasTemplateId;
  label: string;
  /** none → disables the canvas; others apply this preset. */
  preset: Pick<CanvasScene, "background" | "layout" | "texts"> | null;
  /** Bubble template: park the camera big and centered. */
  centersBubble?: boolean;
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  { id: "none", label: "None", preset: null },
  {
    id: "meeting",
    label: "Meeting",
    preset: {
      background: "gradient",
      layout: "short-list",
      texts: {
        heading: "Team meeting",
        "item-0": "Wins since last time",
        "item-1": "What's coming next",
        "item-2": "Where we need help",
      },
    },
  },
  {
    id: "standup",
    label: "Standup",
    preset: {
      background: "geometric",
      layout: "short-list",
      texts: {
        heading: "Daily standup",
        "item-0": "Yesterday",
        "item-1": "Today",
        "item-2": "Blockers",
      },
    },
  },
  {
    id: "celebration",
    label: "Celebration",
    preset: {
      background: "rainbow",
      layout: "centered",
      texts: {
        heading: "Congratulations! 🎉",
        subheading: "Huge milestone — this one took all of us.",
      },
    },
  },
  {
    id: "news",
    label: "News",
    preset: {
      background: "splash",
      layout: "slide-two",
      texts: {
        subheading: "TEAM UPDATE",
        heading: "Some big news",
        body: "Watch to the end — questions always welcome.",
      },
    },
  },
  {
    id: "intro",
    label: "Intro",
    preset: {
      background: "paint",
      layout: "centered",
      texts: {
        heading: "Hi, I'm …",
        subheading: "A quick hello — who I am and what I'm working on.",
      },
    },
  },
  {
    id: "bubble",
    label: "Bubble",
    preset: {
      background: "flowers",
      layout: "empty",
      texts: {},
    },
    centersBubble: true,
  },
];

/** Builds the scene a template represents (template "none" disables). */
export function applyCanvasTemplate(scene: CanvasScene, template: CanvasTemplate): CanvasScene {
  if (!template.preset) {
    return { ...scene, enabled: false, template: "none" };
  }
  return {
    enabled: true,
    template: template.id,
    background: template.preset.background,
    layout: template.preset.layout,
    texts: { ...template.preset.texts },
  };
}

// ---------------------------------------------------------------------------
// Compositor — paints the scene exactly like the DOM stage renders it.
// ---------------------------------------------------------------------------

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Draws background + text slots. The engine draws the bubble afterwards. */
export function paintCanvasScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: CanvasScene,
): void {
  CANVAS_BACKGROUND_PAINTERS[scene.background](ctx, w, h);

  const slots = CANVAS_LAYOUTS[scene.layout];
  if (slots.length === 0) return;
  const ink = canvasInkColor(scene.background);

  for (const slot of slots) {
    const text = (scene.texts[slot.key] ?? "").trim();
    if (!text) continue;

    const fontPx = slot.size * w;
    ctx.save();
    ctx.font = `${slot.weight} ${fontPx}px ${CANVAS_FONT_STACK}`;
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    if (ink === "#ffffff") {
      ctx.shadowColor = "rgba(10, 8, 24, 0.35)";
      ctx.shadowBlur = fontPx * 0.18;
      ctx.shadowOffsetY = fontPx * 0.04;
    }

    const bulletIndent = slot.bullet ? fontPx * 0.95 : 0;
    const boxX = slot.x * w;
    const maxWidth = slot.w * w - bulletIndent;
    const lines = wrapText(ctx, text, maxWidth);
    const lineStep = slot.lineHeight * fontPx;

    if (slot.bullet) {
      ctx.beginPath();
      ctx.arc(boxX + fontPx * 0.22, slot.y * h + fontPx * 0.52, fontPx * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = slot.align === "center" ? "center" : "left";
    const textX = slot.align === "center" ? boxX + (slot.w * w) / 2 : boxX + bulletIndent;
    lines.forEach((line, index) => {
      // First baseline sits ~0.85em below the slot top — matches DOM line box.
      ctx.fillText(line, textX, slot.y * h + fontPx * 0.85 + index * lineStep);
    });
    ctx.restore();
  }
}
