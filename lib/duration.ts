const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * A span of time as people say it: "42m", "5h 10m", "3 days", "4 months",
 * "2.1 years". Hours and minutes only while that is still useful.
 */
export function formatSpan(ms: number): string {
  const abs = Math.max(0, Math.abs(ms));
  if (abs < HOUR) return `${Math.max(1, Math.floor(abs / MIN))}m`;
  if (abs < 2 * DAY) return `${Math.floor(abs / HOUR)}h ${Math.floor((abs % HOUR) / MIN)}m`;
  const days = Math.floor(abs / DAY);
  if (days < 60) return `${days} days`;
  if (days < 730) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years`;
}
