"use client";

import { Pause, Square } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

function TrafficLights() {
  return (
    <div className="absolute left-4 flex items-center gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57]" />
      <span className="size-3 rounded-full bg-[#febc2e]" />
      <span className="size-3 rounded-full bg-[#28c840]" />
    </div>
  );
}

function CameraBubble() {
  return (
    <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6">
      <div className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 shadow-2xl ring-2 ring-white/20 sm:size-20">
        <span className="text-base font-semibold text-white sm:text-xl">RY</span>
      </div>
    </div>
  );
}

function ControlBar() {
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/70 py-2 pr-2.5 pl-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-md sm:bottom-6">
      {/* Pulsing REC dot */}
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-red-500" />
      </span>
      <span className="font-mono text-xs font-medium tracking-wide text-white tabular-nums">
        REC 01:24
      </span>
      <span className="h-4 w-px bg-white/15" />
      <span className="flex size-7 items-center justify-center rounded-full text-white/80">
        <Pause className="size-3.5 fill-current" />
      </span>
      <span className="flex size-7 items-center justify-center rounded-full bg-red-500/90 text-white">
        <Square className="size-3 fill-current" />
      </span>
    </div>
  );
}

/**
 * Decorative macOS app window — the Ryloom recorder mid-recording.
 * Pure JSX/Tailwind, gentle perspective entrance via motion.
 */
export function HeroMockup() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden="true"
      className="relative"
      initial={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, y: 48, scale: 0.97, rotateX: 10 }
      }
      animate={
        reduceMotion
          ? { opacity: 1 }
          : { opacity: 1, y: 0, scale: 1, rotateX: 0 }
      }
      transition={{ duration: 1, delay: 0.35, ease: EASE }}
      style={{ transformPerspective: 1200 }}
    >
      {/* Soft glow behind the window */}
      <div className="absolute -inset-x-12 top-12 -bottom-10 -z-10 rounded-[3rem] bg-primary/10 blur-3xl" />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 ring-1 ring-foreground/5">
        {/* Title bar */}
        <div className="relative flex h-10 items-center justify-center border-b border-border bg-muted/50 px-4">
          <TrafficLights />
          <span className="text-xs font-medium text-muted-foreground">
            ryloom — recording
          </span>
        </div>

        {/* Dark video canvas */}
        <div className="relative aspect-video bg-[#0e0d14]">
          {/* Subtle violet gradients */}
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_0%,rgba(98,93,245,0.25),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_85%_100%,rgba(98,93,245,0.12),transparent_60%)]" />
          {/* Faint grid */}
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
              backgroundSize: "36px 36px",
            }}
          />

          <CameraBubble />
          <ControlBar />
        </div>
      </div>
    </motion.div>
  );
}
