"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordTooShort = password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const showLengthError = touched && passwordTooShort;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (passwordTooShort || password !== confirm) return;

    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setPending(false);
      return;
    }
    toast.success("Password updated. You're all set!");
    router.push("/app");
    router.refresh();
  }

  return (
    <AuthCard
      title="Set a new password"
      description="Choose a strong password for your account"
      footer={
        <p>
          Link expired?{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Request a new one
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <AuthAlert message={error} /> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">New password</Label>
          <PasswordInput
            id="new-password"
            name="new-password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            autoFocus
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={pending}
            aria-invalid={showLengthError}
            className={cn(
              showLengthError &&
                "border-destructive focus-visible:ring-destructive/40",
            )}
          />
          {showLengthError ? (
            <p className="text-xs text-destructive">
              Password must be at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <PasswordInput
            id="confirm-password"
            name="confirm-password"
            placeholder="Repeat your new password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={pending}
            aria-invalid={mismatch}
            className={cn(
              mismatch && "border-destructive focus-visible:ring-destructive/40",
            )}
          />
          {mismatch ? (
            <p className="text-xs text-destructive">Passwords don&apos;t match.</p>
          ) : null}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={
            pending || passwordTooShort || confirm.length === 0 || mismatch
          }
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
