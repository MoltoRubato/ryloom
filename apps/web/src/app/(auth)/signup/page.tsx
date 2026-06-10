"use client";

import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthCard } from "@/components/auth/auth-card";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  EMAIL_PLACEHOLDER,
  isAllowedEmailDomain,
  RESTRICTED_DOMAIN_MESSAGE,
} from "@/lib/allowed-domain";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const passwordTooShort = password.length < MIN_PASSWORD_LENGTH;
  const showPasswordError = passwordTouched && passwordTooShort;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordTouched(true);
    if (passwordTooShort) return;

    setError(null);
    if (!isAllowedEmailDomain(email)) {
      setError(RESTRICTED_DOMAIN_MESSAGE);
      return;
    }
    setPending(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setPending(false);
      return;
    }

    // Supabase returns a user with no identities when the email is already
    // registered and confirmation is required — surface that clearly.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError("An account with this email already exists. Try signing in instead.");
      setPending(false);
      return;
    }

    if (data.session) {
      router.push("/onboarding");
      router.refresh();
      return;
    }

    setPending(false);
    setConfirmationSent(true);
  }

  if (confirmationSent) {
    return (
      <AuthCard
        title="Check your email"
        description="One more step to finish creating your account."
        footer={
          <p>
            Wrong email?{" "}
            <Button
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => {
                setConfirmationSent(false);
                setError(null);
              }}
            >
              Start over
            </Button>
          </p>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>.
            Click it to activate your account and get started.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start recording and sharing videos in minutes"
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <AuthAlert message={error} /> : null}

        <GoogleButton next="/onboarding" label="Sign up with Google" disabled={pending} />

        <div className="relative">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
            or
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              name="name"
              placeholder="Ada Lovelace"
              autoComplete="name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              placeholder={EMAIL_PLACEHOLDER}
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              disabled={pending}
              aria-invalid={showPasswordError}
              className={cn(
                showPasswordError &&
                  "border-destructive focus-visible:ring-destructive/40",
              )}
            />
            <p
              className={cn(
                "text-xs",
                showPasswordError ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {showPasswordError
                ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                : `Use ${MIN_PASSWORD_LENGTH}+ characters. A mix of words works great.`}
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={
              pending ||
              name.trim().length === 0 ||
              email.trim().length === 0 ||
              passwordTooShort
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Create account
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          By signing up you agree to our terms of service and privacy policy.
        </p>
      </div>
    </AuthCard>
  );
}
