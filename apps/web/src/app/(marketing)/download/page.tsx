import { type Metadata } from "next";
import Link from "next/link";

import { AppleLogo } from "@/components/marketing/download-cta";
import { FadeIn } from "@/components/marketing/motion-primitives";
import { Button } from "@/components/ui/button";
import { env } from "@/env";

export const metadata: Metadata = {
  title: "Download for macOS",
  description:
    "Get the Ryloom desktop recorder for macOS — download the app or build it from source. Apple Silicon & Intel, macOS 12+.",
};

const BUILD_COMMANDS = [
  "pnpm install",
  "pnpm --filter @ryloom/desktop dist",
  "open apps/desktop/dist/Ryloom-*.dmg",
] as const;

const AFTER_INSTALL = [
  {
    number: "01",
    title: "Sign in with Google",
    description: "Open the app and sign in with the Google account you use on the web.",
  },
  {
    number: "02",
    title: "Pick a screen",
    description: "Choose a display or window — add your webcam if you want a face on it.",
  },
  {
    number: "03",
    title: "Press record",
    description: "When you stop, the share link is already on your clipboard.",
  },
] as const;

function TerminalBlock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#0e0d14] shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-xs text-zinc-500">ryloom — zsh</span>
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-7 text-zinc-200">
        <code>
          {BUILD_COMMANDS.map((command) => (
            <span key={command} className="block">
              <span className="text-zinc-500 select-none">$ </span>
              {command}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export default function DownloadPage() {
  const downloadUrl = env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL;

  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <FadeIn>
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          Download
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          Download Ryloom for macOS
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          A focused screen recorder that lives in your menu bar. Record, stop,
          and the share link is on your clipboard.
        </p>
      </FadeIn>

      {downloadUrl ? (
        <FadeIn delay={0.08}>
          <div className="mt-10">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-xl px-7 text-base font-semibold shadow-lg shadow-primary/25 transition-shadow hover:shadow-xl hover:shadow-primary/30"
            >
              <a href={downloadUrl}>
                <AppleLogo className="size-4.5" />
                Download for macOS
              </a>
            </Button>
            <p className="mt-3 text-sm text-muted-foreground">
              Apple Silicon &amp; Intel · macOS 12+
            </p>
          </div>
        </FadeIn>
      ) : null}

      <FadeIn delay={0.12}>
        <section className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {downloadUrl ? "Or build it from source" : "Build it from source"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Self-hosting Ryloom? The desktop app builds straight from the
            monorepo — Apple Silicon &amp; Intel, macOS 12+.
          </p>
          <div className="mt-6">
            <TerminalBlock />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            The build is unsigned, so macOS will warn you on first launch.
            Right-click{" "}
            <span className="font-medium text-foreground">Ryloom.app</span> and
            choose <span className="font-medium text-foreground">Open</span> —
            you only have to do this once.
          </p>
        </section>
      </FadeIn>

      <FadeIn delay={0.16}>
        <section className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            After installing
          </h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-6">
            {AFTER_INSTALL.map((step) => (
              <div key={step.number}>
                <span
                  aria-hidden="true"
                  className="block font-mono text-4xl font-semibold tracking-tighter text-foreground/10 tabular-nums select-none"
                >
                  {step.number}
                </span>
                <h3 className="mt-3 text-base font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <p className="mt-16 border-t border-border/60 pt-8 text-sm text-muted-foreground">
          Recording from Chrome?{" "}
          <Link
            href="/download-extension"
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            Get the Chrome extension
          </Link>
          , or{" "}
          <Link
            href="/record"
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            record in your browser
          </Link>
          .
        </p>
      </FadeIn>
    </div>
  );
}
