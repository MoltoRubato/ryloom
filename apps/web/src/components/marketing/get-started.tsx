import Link from "next/link";

import { DownloadForMacButton } from "@/components/marketing/download-cta";
import { FadeIn } from "@/components/marketing/motion-primitives";

export function GetStarted() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
        <FadeIn>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            Get started
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            Ready when you are.
          </h2>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-8 flex justify-center">
            <DownloadForMacButton />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Apple Silicon &amp; Intel · macOS 12+
          </p>
        </FadeIn>

        <FadeIn delay={0.18}>
          <div className="mt-12 flex flex-col items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground sm:flex-row">
            <span>
              Prefer the browser?{" "}
              <Link
                href="/record"
                className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                Record at ryloom in your browser
              </Link>
            </span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
