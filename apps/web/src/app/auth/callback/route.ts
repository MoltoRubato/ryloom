import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/app";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Missing sign-in code. Please try again.")}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Internal tool: reject accounts outside the allowed email domain.
  const allowedDomain =
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "lyratechnologies.com.au";
  const email = data.user?.email ?? "";
  if (
    allowedDomain !== "*" &&
    !email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)
  ) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=restricted_domain`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
