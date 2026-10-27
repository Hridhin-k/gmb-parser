import { createClient } from "@/lib/supabase/server";
import { clearSupabaseAuthCookies } from "@/lib/supabase/clear-auth-cookies";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const { origin } = new URL(request.url);
  const redirectTo = NextResponse.redirect(`${origin}/login`);
  const cookieStore = await cookies();
  clearSupabaseAuthCookies(cookieStore, redirectTo);
  return redirectTo;
}
