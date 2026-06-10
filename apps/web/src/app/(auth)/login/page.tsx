"use client";

import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthCard } from "@/components/auth/auth-card";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

function sanitizeNext(value: string | null): string | null {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}

function OrDivider() {
  return (
    <div className="relative">
      <Separator />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
        or
      </span>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));
  const urlError = searchParams.get("error");

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const displayError = error ?? urlError;

  async function handlePasswordSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }
    router.push(next ?? "/app");
    router.refresh();
  }

  async function handleMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next ?? "/app")}`,
      },
    });
    setPending(false);
    if (otpError) {
      setError(otpError.message);
      toast.error(otpError.message);
      return;
    }
    setMagicLinkSent(true);
  }

  if (magicLinkSent) {
    return (
      <AuthCard
        title="Check your inbox"
        description="We sent you a magic sign-in link."
        footer={
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => {
              setMagicLinkSent(false);
              setError(null);
            }}
          >
            Use a different email
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            Click the link we emailed to{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>{" "}
            to sign in. It expires shortly, so use it soon.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      description={
        mode === "password"
          ? "Sign in to your Ryloom account"
          : "We'll email you a one-click sign-in link"
      }
      footer={
        <p>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {displayError ? <AuthAlert message={displayError} /> : null}

        <GoogleButton next={next ?? "/app"} disabled={pending} />

        <OrDivider />

        <form
          onSubmit={mode === "password" ? handlePasswordSignIn : handleMagicLink}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </div>

          {mode === "password" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                name="password"
                placeholder="Your password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </div>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={
              pending ||
              email.trim().length === 0 ||
              (mode === "password" && password.length === 0)
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {mode === "password" ? "Sign in" : "Send magic link"}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="w-full text-sm font-normal text-muted-foreground"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMode((m) => (m === "password" ? "magic" : "password"));
          }}
        >
          {mode === "password"
            ? "Email me a magic link instead"
            : "Use a password instead"}
        </Button>
      </div>
    </AuthCard>
  );
}

function LoginFallback() {
  return (
    <AuthCard title="Welcome back" description="Sign in to your Ryloom account">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-4 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
