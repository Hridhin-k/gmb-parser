/** Deliberately disabled in builds/production, even if copied env flags remain. */
export function devLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "development" || env.AUTH_DEV_LOGIN !== "true" || !env.AUTH_DEV_LOGIN_TOKEN) return false;
  return localDevelopmentOrigin(env);
}

/** Let a local OAuth user create their own tenant without a platform invite. */
export function localSignupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && env.AUTH_DEV_OPEN_SIGNUP === "true" && localDevelopmentOrigin(env);
}

function localDevelopmentOrigin(env: NodeJS.ProcessEnv): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.AUTH_URL || "").hostname);
  } catch { return false; }
}
