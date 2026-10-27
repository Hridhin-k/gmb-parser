/** Deliberately disabled in builds/production, even if copied env flags remain. */
export function devLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "development" || env.AUTH_DEV_LOGIN !== "true" || !env.AUTH_DEV_LOGIN_TOKEN) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.AUTH_URL || "").hostname);
  } catch { return false; }
}
