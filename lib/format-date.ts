/**
 * The only date formats the UI should show. Raw ISO strings
 * ("2026-10-20T13:42:55.1+00:00") never reach the screen.
 * Friendly forms: "Oct 20, 2026, 1:42 PM" and "Oct 20, 2026".
 */

export function formatFriendlyDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
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
