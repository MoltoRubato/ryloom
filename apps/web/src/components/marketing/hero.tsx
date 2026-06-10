import Link from "next/link";

import { DownloadForMacButton } from "@/components/marketing/download-cta";
import { HeroMockup } from "@/components/marketing/hero-mockup";
import { FadeIn } from "@/components/marketing/motion-primitives";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Quiet background glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-14rem] left-1/2 h-[26rem] w-[48rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-24 pb-24 sm:px-6 sm:pt-32 sm:pb-28 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <FadeIn>
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              Screen recording for macOS
            </p>
          </FadeIn>

          <FadeIn delay={0.08}>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl lg:text-7xl">
              Record your screen.
              <br />
              <span className="text-muted-foreground">Share it in seconds.</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.16}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              A focused screen recorder for teams. Capture, share, and track —
              with no friction in between.
            </p>
          </FadeIn>

          <FadeIn delay={0.24}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <DownloadForMacButton className="w-full sm:w-auto" />
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 w-full rounded-xl px-7 text-base sm:w-auto"
              >
                <Link href="/login?provider=google">Sign in with Google</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Internal tool · macOS 12+ · Sign in with your Lyra account
            </p>
          </FadeIn>
        </div>

        <div className="mx-auto mt-16 max-w-4xl sm:mt-20">
          <HeroMockup />
        </div>
      </div>
    </section>
  );
}
