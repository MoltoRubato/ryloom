import { cn } from "@/lib/utils";

/**
 * Ryloom mark — violet rounded square with a play circle.
 * The one true logo: mirrors public/favicon.svg, marketing/logo.tsx and the
 * desktop app icon so the brand reads the same everywhere.
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
        className={cn("size-9 shadow-sm rounded-xl", iconClassName)}
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="8" className="fill-primary" />
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
