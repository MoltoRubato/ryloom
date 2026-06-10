"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { RyloomLogo } from "@/components/marketing/logo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute top-1/3 left-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <RyloomLogo className="size-12" />
      <p className="mt-8 text-sm font-semibold uppercase tracking-widest text-primary">
        Something went wrong
      </p>
      <h1 className="mt-3 text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        That wasn’t supposed to happen.
      </h1>
      <p className="mt-3 max-w-md text-center text-base leading-relaxed text-muted-foreground">
        An unexpected error interrupted this page. Trying again usually fixes
        it — your videos are safe either way.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Error reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors hover:bg-primary/90"
        >
          <RotateCcw className="size-4" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
        >
          <Home className="size-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
