import { cn } from "@/lib/utils";

import { RYLOOM_BRAND_VIOLET } from "@/components/marketing/logo";

/**
 * Ryloom mark — violet rounded square with a play circle.
 * The one true logo: byte-faithful to public/favicon.svg, marketing/logo.tsx
 * and the desktop app icon so the brand reads the same everywhere. The mark is
 * the fixed brand violet (not the themeable `--primary` token), and the SVG's
 * own rx=8 corners are the only rounding — no extra clip — so it matches the
 * favicon and desktop mark pixel-for-pixel.
 */
export function RyloomLogo({
  className,
  iconClassName,
  wordmarkClassName,
}: {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("size-9", iconClassName)}
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="8" fill={RYLOOM_BRAND_VIOLET} />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.5" />
        <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="#fff" />
      </svg>
      <span
        className={cn(
          "text-xl font-semibold tracking-tight text-foreground",
          wordmarkClassName,
        )}
      >
        Ryloom
      </span>
    </span>
  );
}
