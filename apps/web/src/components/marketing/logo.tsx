import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Ryloom mark — violet rounded square with a play circle.
 * Mirrors public/favicon.svg, with the square driven by the primary token so
 * it adapts to theme and brand overrides.
 */
export function RyloomLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
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
