/**
 * Where an old standalone page (/team, /audit, /portfolio/usage) now lives in Settings.
 * Every query param is kept; `section` always names the new home.
 */
export function settingsRedirect(
  section: string,
  params: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  query.set("section", section);
  for (const [key, value] of Object.entries(params)) {
    if (key === "section" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return `/settings?${query.toString()}`;
}
