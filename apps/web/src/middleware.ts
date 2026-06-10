import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets, the embed player (must stay
     * cookie-free and iframe-able), and public API webhooks.
     */
    "/((?!_next/static|_next/image|favicon.ico|embed|api/webhooks|api/scim|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
