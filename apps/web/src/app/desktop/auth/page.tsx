"use client";

import { Check, Copy, Loader2, MonitorPlay, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

/**
 * Browser → desktop app token handoff.
 *
 * The desktop app opens this page in the user's default browser. Once the
 * user has a Supabase session here, we hand the tokens to the app through a
 * `ryloom://auth#…` deep link. Tokens travel in the URL fragment, so they are
 * never sent to any server or written to request logs.
 *
 * NOTE: /desktop is not in the middleware's protected matcher — auth is
 * handled manually: no session → bounce to /login?next=/desktop/auth.
 */
export default function DesktopAuthPage() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoLaunched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (!session) {
        window.location.href = "/login?next=/desktop/auth";
        return;
      }
      setDeepLink(
        `ryloom://auth#access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-trigger the deep link once, shortly after the page settles.
  useEffect(() => {
    if (!deepLink || autoLaunched.current) return;
    autoLaunched.current = true;
    const timer = setTimeout(() => {
      window.location.assign(deepLink);
    }, 800);
    return () => clearTimeout(timer);
  }, [deepLink]);

  async function copyLink() {
    if (!deepLink) return;
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked — the button simply stays in its idle state.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Card className="rounded-xl border-border shadow-sm">
          <CardHeader className="space-y-3 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MonitorPlay className="size-7" aria-hidden="true" />
            </span>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              Open Ryloom on your desktop
            </CardTitle>
            <CardDescription>
              {deepLink
                ? "You're signed in. Your browser should ask to open the Ryloom app — click “Open Ryloom” when it does."
                : "Checking your session…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {deepLink ? (
              <>
                <Button asChild size="lg" className="w-full">
                  <a href={deepLink}>Open Ryloom</a>
                </Button>

                <div className="rounded-lg border border-border bg-accent/40 p-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    Didn&apos;t open? Make sure the Ryloom desktop app is
                    installed and running, then try the button again — or copy
                    the link and paste it into your browser&apos;s address bar.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-primary"
                    onClick={copyLink}
                  >
                    {copied ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  This link signs the desktop app into your Ryloom account. It
                  stays on this device — the tokens are passed directly to the
                  app and are never sent to a server. Don&apos;t share it with
                  anyone.
                </p>
              </>
            ) : (
              <div className="flex items-center justify-center py-6">
                <Loader2
                  className="size-6 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You can close this tab once the app opens.
        </p>
      </div>
    </main>
  );
}
