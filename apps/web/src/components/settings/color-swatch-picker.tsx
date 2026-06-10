"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const DEFAULT_SWATCHES = [
  "#625DF5", // Ryloom violet
  "#7C3AED",
  "#2563EB",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#111827",
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type ColorSwatchPickerProps = {
  value: string;
  onChange: (hex: string) => void;
  swatches?: string[];
  disabled?: boolean;
  className?: string;
};

/** Preset color swatches plus a free-form hex input. */
export function ColorSwatchPicker({
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
  disabled,
  className,
}: ColorSwatchPickerProps) {
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  const commitHex = (raw: string) => {
    let candidate = raw.trim();
    if (candidate && !candidate.startsWith("#")) candidate = `#${candidate}`;
    if (HEX_RE.test(candidate)) {
      onChange(candidate.toUpperCase());
    } else {
      setHexDraft(value);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {swatches.map((swatch) => {
          const selected = value.toLowerCase() === swatch.toLowerCase();
          return (
            <button
              key={swatch}
              type="button"
              disabled={disabled}
              aria-label={`Use color ${swatch}`}
              aria-pressed={selected}
              className={cn(
                "flex size-7 items-center justify-center rounded-md border border-border shadow-sm transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: swatch }}
              onClick={() => onChange(swatch)}
            >
              {selected && <Check className="size-3.5 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-7 shrink-0 rounded-md border border-border shadow-sm"
          style={{ backgroundColor: HEX_RE.test(hexDraft) ? hexDraft : value }}
        />
        <input
          type="text"
          aria-label="Hex color"
          spellCheck={false}
          maxLength={7}
          disabled={disabled}
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitHex(hexDraft);
            }
          }}
          className="h-8 w-24 rounded-lg border border-input bg-transparent px-2 font-mono text-xs uppercase shadow-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>
  );
}
