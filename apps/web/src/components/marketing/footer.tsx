import Link from "next/link";

import { RyloomLogo } from "@/components/marketing/logo";
import { ThemeToggle } from "@/components/marketing/theme-toggle";

const FOOTER_LINKS = [
  { label: "Security", href: "/security" },
  { label: "Download", href: "/download" },
  { label: "Chrome extension", href: "/download-extension" },
] as const;

/** Minimal single-row footer: brand, inline links, theme toggle. */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row lg:px-8">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-80"
            aria-label="Ryloom home"
          >
            <RyloomLogo className="size-6" />
            <span className="text-sm font-semibold tracking-tight">Ryloom</span>
          </Link>
          <span className="text-sm text-muted-foreground">© 2026 Ryloom</span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </footer>
  );
}
