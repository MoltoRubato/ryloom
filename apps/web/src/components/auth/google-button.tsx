"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.28H12v4.51h6.46a5.55 5.55 0 0 1-2.4 3.62v3h3.87c2.26-2.09 3.56-5.17 3.56-8.85z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.12-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.18 7.18 0 0 1 0-4.58V6.62H1.29a12.01 12.01 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.2 15.24 0 12 0 7.31 0 3.25 2.69 1.29 6.62l3.98 3.09c.95-2.84 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

type GoogleButtonProps = {
  /** In-app path to land on after the OAuth round-trip. Must start with "/". */
  next?: string;
  label?: string;
  disabled?: boolean;
};

export function GoogleButton({
  next = "/app",
  label = "Continue with Google",
  disabled = false,
}: GoogleButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const supabase = createClient();
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    if (error) {
      toast.error(error.message);
      setPending(false);
    }
    // On success the browser navigates to Google — keep the pending state.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={disabled || pending}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <GoogleIcon />
      )}
      {label}
    </Button>
  );
}
