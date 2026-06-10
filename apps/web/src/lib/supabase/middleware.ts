import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: avoid logic between client creation and getUser() — the token
  // refresh must run on every request that hits the middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/app") || pathname.startsWith("/record") || pathname.startsWith("/onboarding");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Internal tool: only accounts on the allowed email domain may use the app.
  const allowedDomain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "lyratechnologies.com.au";
  const domainAllowed =
    !user ||
    allowedDomain === "*" ||
    (user.email ?? "").toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`);

  if (user && isProtected && !domainAllowed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", "restricted_domain");
    return NextResponse.redirect(url);
  }

  if (user && domainAllowed && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
