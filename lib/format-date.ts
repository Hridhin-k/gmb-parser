/**
 * The only date formats the UI should show. Raw ISO strings
 * ("2026-10-20T13:42:55.1+00:00") never reach the screen.
 * Friendly forms: "Oct 20, 2026, 1:42 PM", "Oct 20, 2026, 01:42 PM", and "Oct 20, 2026".
 * `hour` "2-digit" keeps a leading zero. The default stays "1:42 PM".
 */

export function formatFriendlyDateTime(
  iso: string | null | undefined,
  hour: "numeric" | "2-digit" = "numeric",
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour,
    minute: "2-digit",
  });
}

export function formatFriendlyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
