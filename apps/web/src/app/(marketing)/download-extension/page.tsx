import {
  AppWindow,
  Camera,
  Chrome,
  FolderOpen,
  Keyboard,
  Link2,
  MonitorPlay,
  MousePointerClick,
  ToggleRight,
  Video,
  Zap,
} from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { RyloomLogo } from "@/components/marketing/logo";
import { FadeIn, Float } from "@/components/marketing/motion-primitives";

export const metadata: Metadata = {
  title: "Chrome extension",
  description:
    "Install the Ryloom Screen Recorder extension for Chrome: one click opens the Ryloom recorder with your current tab linked as context, plus an Alt+Shift+R shortcut.",
};

const CAPABILITIES = [
  {
    icon: MousePointerClick,
    title: "One-click recording",
    description:
      "Click the toolbar icon and the Ryloom recorder opens instantly — no digging through bookmarks or tabs.",
  },
  {
    icon: Link2,
    title: "Tab context attached",
    description:
      "The page you were on is linked to the recording automatically, so viewers always know what you were looking at.",
  },
  {
    icon: Zap,
    title: "Keyboard shortcut",
    description:
      "Start a recording for the current tab from anywhere in Chrome with a single shortcut.",
  },
] as const;

const INSTALL_STEPS = [
  {
    icon: Chrome,
    title: "Open the extensions page",
    description: (
      <>
        In Chrome, navigate to{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
          chrome://extensions
        </code>{" "}
        (or Menu → Extensions → Manage Extensions).
      </>
    ),
  },
  {
    icon: ToggleRight,
    title: "Enable Developer mode",
    description: (
      <>
        Flip the <strong className="font-semibold">Developer mode</strong>{" "}
        toggle in the top-right corner of the extensions page.
      </>
    ),
  },
  {
    icon: FolderOpen,
    title: "Load unpacked",
    description: (
      <>
        Click <strong className="font-semibold">Load unpacked</strong> and
        select the{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
          extension/
        </code>{" "}
        folder from your Ryloom checkout.
      </>
    ),
  },
  {
    icon: Video,
    title: "Pin it and record",
    description: (
      <>
        Pin <strong className="font-semibold">Ryloom Screen Recorder</strong>{" "}
        to your toolbar, click it on any page, and you’re rolling.
      </>
    ),
  },
] as const;

function PopupMockup() {
  return (
    <div className="w-full max-w-xs rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <RyloomLogo className="size-6" />
        <span className="text-sm font-semibold text-foreground">Ryloom</span>
        <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
          Signed in
        </span>
      </div>

      {/* Mode picker */}
      <div className="p-4">
        <p className="text-xs font-medium text-muted-foreground">
          What do you want to record?
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-primary bg-accent px-2 py-3">
            <MonitorPlay className="size-5 text-primary" />
            <span className="text-[11px] font-semibold text-accent-foreground">
              Screen + cam
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border px-2 py-3">
            <AppWindow className="size-5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">
              Screen only
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border px-2 py-3">
            <Camera className="size-5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">
              Camera only
            </span>
          </div>
        </div>

        {/* Tab context */}
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <Link2 className="size-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-foreground">
              Linking current tab
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              app.northbeam.io/dashboard
            </p>
          </div>
        </div>

        {/* Start button */}
        <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20">
          <span className="size-2 rounded-full bg-red-300" />
          Start recording
        </div>

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          or press{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            Alt
          </kbd>{" "}
          +{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            Shift
          </kbd>{" "}
          +{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            R
          </kbd>
        </p>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5 text-center">
        <span className="text-[11px] font-medium text-primary">
          Open my library →
        </span>
      </div>
    </div>
  );
}

export default function DownloadExtensionPage() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10"
      >
        <div className="mx-auto h-80 w-[48rem] max-w-full rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
              <Chrome className="size-3.5 text-primary" />
              Ryloom Screen Recorder for Chrome
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Recording is one click away. Always.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              The Ryloom extension lives in your toolbar. Click it — or hit the
              shortcut — and the recorder opens with your current tab linked as
              context, ready to capture your screen, camera, or both.
            </p>
            <div className="mt-8 space-y-5">
              {CAPABILITIES.map((capability) => (
                <div key={capability.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <capability.icon className="size-4.5 text-primary" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {capability.title}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {capability.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.15} y={32} className="flex justify-center">
            <Float amplitude={7} duration={5.5}>
              <PopupMockup />
            </Float>
          </FadeIn>
        </div>

        {/* Install steps */}
        <FadeIn delay={0.1} y={32} className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Install in under a minute
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
            The extension ships with the Ryloom repository and loads as an
            unpacked extension — no store listing required.
          </p>
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {INSTALL_STEPS.map((step, index) => (
              <div
                key={step.title}
                className="relative rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <span className="absolute top-5 right-5 text-3xl font-bold text-muted-foreground/15 tabular-nums">
                  {index + 1}
                </span>
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <step.icon className="size-4.5 text-primary" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* Shortcut note */}
        <FadeIn delay={0.1} className="mx-auto mt-14 max-w-3xl">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:gap-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Keyboard className="size-5 text-primary" />
            </span>
            <div className="text-center sm:text-left">
              <h3 className="text-sm font-semibold text-foreground">
                Keyboard shortcut
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  Alt+Shift+R
                </kbd>{" "}
                from any tab to start a recording for the current page. You can
                rebind it anytime at{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  chrome://extensions/shortcuts
                </code>
                .
              </p>
            </div>
          </div>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.1} className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">
            Prefer to record without installing anything?
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90"
          >
            Record in the browser — free
          </Link>
        </FadeIn>
      </div>
    </div>
  );
}
