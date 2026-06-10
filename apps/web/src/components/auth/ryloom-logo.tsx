import { cn } from "@/lib/utils";

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
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm",
          iconClassName,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          className="size-4.5"
          aria-hidden="true"
        >
          <line x1="12" y1="3" x2="12" y2="8" />
          <line x1="12" y1="16" x2="12" y2="21" />
          <line x1="3" y1="12" x2="8" y2="12" />
          <line x1="16" y1="12" x2="21" y2="12" />
          <line x1="5.6" y1="5.6" x2="9.15" y2="9.15" />
          <line x1="14.85" y1="14.85" x2="18.4" y2="18.4" />
          <line x1="5.6" y1="18.4" x2="9.15" y2="14.85" />
          <line x1="14.85" y1="9.15" x2="18.4" y2="5.6" />
        </svg>
      </span>
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
