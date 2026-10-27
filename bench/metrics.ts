export const DASHBOARD_P95_MS = 500;
export const INBOX_P95_MS = 500;
export const CRITICAL_P99_MS = 1_500;
export const MAX_ERROR_RATE = 0.01;
export const STOP_ERROR_RATE = 0.05;
export const ADVANCE_P95_MS = 5_000;
export const STATEMENT_TIMEOUT_MS = 15_000;
export const STAGE_CONCURRENCY = [1, 5, 10, 25, 50] as const;

export type LatencySample = {
  workload: string;
  ms: number;
  ok: boolean;
  cold: boolean;
  bytes: number;
  timedOut: boolean;
};

export type LatencySummary = {
  requests: number;
  errors: number;
  timeouts: number;
  errorRate: number;
  rps: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  bytesP95: number | null;
};

export type TargetVerdict = {
  workload: string;
  group: "dashboard" | "inbox" | "critical" | "probe" | "write";
  warm: LatencySummary;
  coldMs: number | null;
  passed: boolean;
  reason: string;
};

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function summarize(samples: LatencySample[], elapsedMs: number): LatencySummary {
  const ok = samples.filter((sample) => sample.ok);
  const latencies = ok.map((sample) => sample.ms);
  const bytes = ok.map((sample) => sample.bytes);
  const errors = samples.filter((sample) => !sample.ok).length;
  return {
    requests: samples.length,
    errors,
    timeouts: samples.filter((sample) => sample.timedOut).length,
    errorRate: samples.length === 0 ? 0 : errors / samples.length,
    rps: elapsedMs <= 0 ? 0 : (samples.length / elapsedMs) * 1000,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    bytesP95: percentile(bytes, 0.95),
  };
}

export function shouldStop(summary: LatencySummary): string | null {
  if (summary.requests >= 10 && summary.errorRate >= STOP_ERROR_RATE) {
    return `error rate ${(summary.errorRate * 100).toFixed(1)}% reached the ${STOP_ERROR_RATE * 100}% stop line`;
  }
  if (summary.timeouts >= 3) {
    return "three statement timeouts; stopping so the run cannot pile up";
  }
  return null;
}

export function canAdvance(summary: LatencySummary): boolean {
  return summary.errorRate < MAX_ERROR_RATE && (summary.p95Ms === null || summary.p95Ms < ADVANCE_P95_MS);
}

export function verdictFor(input: {
  workload: string;
  group: TargetVerdict["group"];
  warm: LatencySummary;
  coldMs: number | null;
}): TargetVerdict {
  const { warm, coldMs } = input;
  if (input.group === "probe" || input.group === "write") {
    const passed = warm.errorRate < MAX_ERROR_RATE;
    return {
      ...input,
      passed,
      reason: passed
        ? "Recorded. This query is not scored against the 500 ms read target."
        : "Error rate was at or above 1%.",
    };
  }
  const limit = input.group === "critical" ? CRITICAL_P99_MS : input.group === "inbox" ? INBOX_P95_MS : DASHBOARD_P95_MS;
  const stat = input.group === "critical" ? warm.p99Ms : warm.p95Ms;
  const label = input.group === "critical" ? "p99" : "p95";
  const warmOk = stat !== null && stat < limit && warm.errorRate < MAX_ERROR_RATE;
  const coldOk = coldMs === null || coldMs < limit;
  const passed = warmOk && coldOk;
  let reason = "Met the provisional target on the cold sample and the warm sample.";
  if (stat === null) reason = "No successful warm sample.";
  else if (!warmOk) reason = `Warm ${label} ${stat} ms or error rate missed the provisional target of ${limit} ms and under 1% errors.`;
  else if (!coldOk) reason = `Warm sample met the target. Cold sample was ${coldMs} ms, which is reported and does not pass.`;
  return { ...input, passed, reason };
}
