import {
  Captions,
  CloudUpload,
  Link2,
  MonitorPlay,
  Scissors,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { FadeIn } from "@/components/marketing/motion-primitives";

const FEATURES: {
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    icon: Link2,
    title: "Instant sharing",
    description:
      "Stop recording and a shareable link is already on your clipboard.",
  },
  {
    icon: Captions,
    title: "Automatic transcription",
    description:
      "Every recording is transcribed so viewers can read, search, and skim.",
  },
  {
    icon: MonitorPlay,
    title: "HD recording",
    description:
      "Record in full HD and up to 4K with adaptive bitrate streaming on playback.",
  },
  {
    icon: CloudUpload,
    title: "Resumable uploads",
    description:
      "Connections drop, recordings don't. Uploads pick up where they left off.",
  },
  {
    icon: Scissors,
    title: "Filler word auto-edit",
    description:
      "Ums, ahs, and long silences are detected and trimmed for you.",
  },
  {
    icon: Sparkles,
    title: "Title & summary generation",
    description:
      "Each video gets a generated title and summary so you don't have to write them.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <FadeIn>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            Features
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
            Built for fast, clear communication.
          </h2>
        </FadeIn>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <FadeIn key={feature.title} delay={index * 0.05}>
                <div className="h-full rounded-xl border border-border/60 bg-card p-6">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
