import Link from "next/link";

import { RyloomWordmark } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";

/** Minimal sticky marketing nav: wordmark, Download, Sign in. */
export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <RyloomWordmark />

        <div className="flex items-center gap-1.5">
          <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
            <Link href="/download">Download</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
