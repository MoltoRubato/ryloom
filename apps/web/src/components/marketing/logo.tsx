import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The fixed Ryloom brand violet. The mark is locked to this exact hex —
 * NOT the themeable `--primary` token — so it renders identically to the
 * desktop app icon, the tray mark and public/favicon.svg everywhere.
 */
export const RYLOOM_BRAND_VIOLET = "#625DF5";

/**
 * Ryloom mark — violet rounded square with a play circle.
 * Byte-faithful to public/favicon.svg and the desktop app icon/tray mark.
 */
export function RyloomLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill={RYLOOM_BRAND_VIOLET} />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
      />
      <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="#fff" />
    </svg>
  );
}

export function RyloomWordmark({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 text-foreground transition-opacity hover:opacity-80",
        className,
      )}
      aria-label="Ryloom home"
    >
      <RyloomLogo />
      <span className="text-lg font-semibold tracking-tight">Ryloom</span>
    </Link>
  );
}
