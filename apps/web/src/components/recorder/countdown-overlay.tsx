"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Full-screen 3-2-1 countdown shown between "Start recording" and the first
 * recorded frame. `onComplete` fires exactly once when the count reaches zero.
 */
export function CountdownOverlay({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count <= 0) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(() => setCount((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [count, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background/95 backdrop-blur-sm">
      <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
        Recording starts in
      </p>
      <div className="relative flex h-44 w-44 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-primary/30" />
        <div className="absolute inset-0 animate-ping rounded-full border-4 border-primary/40" />
        <span
          key={count}
          className="animate-fade-in text-8xl font-bold tabular-nums text-primary"
        >
          {Math.max(count, 1)}
        </span>
      </div>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
