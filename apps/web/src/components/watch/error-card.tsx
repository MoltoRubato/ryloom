import Link from "next/link";
import { Video, VideoOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Branded full-screen error state for the public share + embed surfaces.
 * Server-component safe (no hooks).
 */
export function ShareErrorCard({
  title = "This video isn't available",
  message,
  dark = false,
  showBranding = true,
}: {
  title?: string;
  message: string;
  dark?: boolean;
  showBranding?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-dvh items-center justify-center p-6",
        dark ? "bg-black" : "bg-background",
      )}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-xl border p-8 text-center shadow-sm",
          dark
            ? "border-white/10 bg-white/5 text-white"
            : "border-border bg-card text-card-foreground",
        )}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <VideoOff className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p
          className={cn(
            "mt-2 text-sm",
            dark ? "text-white/60" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
        {showBranding && (
          <Link
            href="/"
            className={cn(
              "mt-6 inline-flex items-center gap-1.5 text-sm font-medium",
              dark ? "text-white/80 hover:text-white" : "text-primary hover:underline",
            )}
          >
            <Video className="h-4 w-4" />
            Powered by Ryloom
          </Link>
        )}
      </div>
    </div>
  );
}
