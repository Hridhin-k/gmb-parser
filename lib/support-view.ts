/** Match proxy.ts: support cookie blocks mutating /api calls except impersonate and auth. */

export function isSupportBlockedMutation(method: string, url: string): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return false;

  let path: string;
  try {
    path = url.startsWith("http") || url.startsWith("//")
      ? new URL(url, "http://localhost").pathname
      : (url.split("?")[0] ?? url);
  } catch {
    return false;
  }

  if (!path.startsWith("/api/")) return false;
  if (path.includes("/impersonate")) return false;
  if (path.startsWith("/api/auth")) return false;
  return true;
}

export const SUPPORT_READ_ONLY_MESSAGE =
  "Support view is read-only. Exit support view to make changes in your own account.";
