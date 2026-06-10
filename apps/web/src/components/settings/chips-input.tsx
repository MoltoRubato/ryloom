"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type ChipsInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Return false to reject a chip (an error toast is the caller's job). */
  validate?: (chip: string) => boolean;
  /** Normalize a chip before it is added (e.g. lowercase, strip "@"). */
  normalize?: (chip: string) => string;
  className?: string;
  "aria-label"?: string;
};

/**
 * A tag/chip input: type, press Enter (or comma) to add, click X or press
 * Backspace on an empty input to remove.
 */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  disabled,
  validate,
  normalize,
  className,
  "aria-label": ariaLabel,
}: ChipsInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const raw = draft.trim().replace(/,+$/, "").trim();
    if (!raw) return;
    const chip = normalize ? normalize(raw) : raw;
    if (!chip) return;
    if (validate && !validate(chip)) return;
    if (value.includes(chip)) {
      setDraft("");
      return;
    }
    onChange([...value, chip]);
    setDraft("");
  };

  const remove = (chip: string) => {
    onChange(value.filter((c) => c !== chip));
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {value.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground"
        >
          {chip}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${chip}`}
              className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => remove(chip)}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        aria-label={ariaLabel ?? placeholder ?? "Add item"}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        value={draft}
        placeholder={value.length === 0 ? placeholder : undefined}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next.includes(",")) {
            const pieces = next.split(",");
            const remainder = pieces.pop() ?? "";
            const additions: string[] = [];
            for (const piece of pieces) {
              const raw = piece.trim();
              if (!raw) continue;
              const chip = normalize ? normalize(raw) : raw;
              if (!chip) continue;
              if (validate && !validate(chip)) continue;
              if (value.includes(chip) || additions.includes(chip)) continue;
              additions.push(chip);
            }
            if (additions.length > 0) onChange([...value, ...additions]);
            setDraft(remainder);
            return;
          }
          setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            e.preventDefault();
            const last = value[value.length - 1];
            if (last) remove(last);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
