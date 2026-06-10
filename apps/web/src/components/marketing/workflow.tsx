import { FadeIn } from "@/components/marketing/motion-primitives";

const STEPS = [
  {
    number: "01",
    title: "Record",
    description: "Capture your screen, with or without your webcam.",
  },
  {
    number: "02",
    title: "Share",
    description: "The link is copied to your clipboard the moment you stop.",
  },
  {
    number: "03",
    title: "Track",
    description: "Monitor views and engagement on every recording.",
  },
] as const;

export function Workflow() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <FadeIn>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            Workflow
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
            Three steps. Nothing more.
          </h2>
        </FadeIn>

        <div className="mt-14 grid gap-12 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, index) => (
            <FadeIn key={step.number} delay={index * 0.08}>
              <div>
                <span
                  aria-hidden="true"
                  className="block font-mono text-6xl font-semibold tracking-tighter text-foreground/10 tabular-nums select-none sm:text-7xl"
                >
                  {step.number}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
