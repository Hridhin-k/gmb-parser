import { logger } from "@/lib/logger";

/**
 * Times one stage of a server render and emits a structured `perf.stage`
 * log line (Vercel logs) so slow stages are visible per page instead of
 * guessed. Stages under 5ms are skipped to keep logs readable.
 */
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    if (durationMs >= 5) {
      logger.info("perf.stage", { stage, durationMs });
    }
  }
}

/** Formats Server-Timing header entries: `name;dur=12`. */
export function serverTimingHeader(entries: Array<readonly [string, number]>): string {
  return entries.map(([name, ms]) => `${name};dur=${Math.max(0, Math.round(ms))}`).join(", ");
}
