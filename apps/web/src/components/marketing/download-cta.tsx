import Link from "next/link";

import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { cn } from "@/lib/utils";

/** Apple logo glyph (filled, inherits currentColor). */
export function AppleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-.701" />
    </svg>
  );
}

/**
 * Primary "Download for macOS" call to action.
 * Points at the hosted desktop build when NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL is
 * configured, otherwise falls back to the /download instructions page.
 * Server component — env is read at render time.
 */
export function DownloadForMacButton({ className }: { className?: string }) {
  const href = env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL ?? "/download";
  const isExternal = href.startsWith("http");

  const label = (
    <>
      <AppleLogo className="size-4.5" />
      Download for macOS
    </>
  );

  return (
    <Button
      asChild
      size="lg"
      className={cn(
        "h-12 rounded-xl px-7 text-base font-semibold shadow-lg shadow-primary/25 transition-shadow hover:shadow-xl hover:shadow-primary/30",
        className,
      )}
    >
      {isExternal ? <a href={href}>{label}</a> : <Link href={href}>{label}</Link>}
    </Button>
  );
}
