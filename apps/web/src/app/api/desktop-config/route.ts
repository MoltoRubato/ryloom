import { env } from "@/env";

/**
 * Bootstrap config for the desktop app (and other native clients).
 * The desktop app only stores an App URL; it fetches the Supabase connection
 * details from here so self-hosters never have to copy keys around.
 * Anon key + URLs are public by design (they ship in the web bundle too).
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};

export function GET() {
  return Response.json(
    {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    },
    { headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
