/**
 * Drop Supabase auth cookies on this host.
 * Leftover `sb-<other-ref>-*` cookies from prior projects inflate Cookie
 * headers on localhost and can trigger HTTP 431 before the app runs.
 *
 * When `keepProjectRef` is set, cookies for that project are preserved
 * (needed after a successful OAuth exchange that just wrote the session).
 */
export function clearSupabaseAuthCookies(
  cookieStore: {
    getAll: () => Array<{ name: string }>;
    set: (name: string, value: string, options: { path: string; maxAge: number }) => void;
  },
  response?: { cookies: { set: (name: string, value: string, options: { path: string; maxAge: number }) => void } },
  keepProjectRef?: string
): string[] {
  const cleared: string[] = [];
  const keepFragment = keepProjectRef ? `sb-${keepProjectRef}` : null;
  for (const { name } of cookieStore.getAll()) {
    if (!name.startsWith("sb-")) continue;
    if (keepFragment && name.startsWith(keepFragment)) continue;
    cookieStore.set(name, "", { path: "/", maxAge: 0 });
    response?.cookies.set(name, "", { path: "/", maxAge: 0 });
    cleared.push(name);
  }
  return cleared;
}
