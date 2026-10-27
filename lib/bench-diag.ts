import { cache } from "react";
import { STAGING_SUPABASE_REF, projectRefFromSupabaseUrl } from "@/lib/supabase/config";

/**
 * Staging-only, opt-in request diagnostics for authenticated HTTP benchmarks.
 * Never records review text, emails, cookies, or tokens.
 *
 * Enable with REVUPILOT_APP_DIAG=1 against the staging Supabase project only.
 *
 * Per-request state uses React `cache()` so RSC loaders share one snapshot
 * without relying on AsyncLocalStorage across Next's scheduling boundary.
 */

export type BenchDiagCacheEvent = "hit" | "miss" | "singleflight";

export type BenchDiagRpcEvent = {
  name: string;
  ms: number;
  ok: boolean;
};

export type BenchDiagSnapshot = {
  id: string;
  startedAt: number;
  cache: { hit: number; miss: number; singleflight: number };
  rpcs: BenchDiagRpcEvent[];
  sequentialHints: number;
  parallelBatches: number;
  notes: string[];
};

type DiagState = BenchDiagSnapshot;

const MAX_STORED = 200;
const ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

type GlobalDiag = { __revupilotBenchDiag?: Map<string, DiagState> };

/** Shared across RSC / route handler module instances in the same Node process. */
function diagMap(): Map<string, DiagState> {
  const g = globalThis as GlobalDiag;
  if (!g.__revupilotBenchDiag) g.__revupilotBenchDiag = new Map();
  return g.__revupilotBenchDiag;
}

function emptySnapshot(id: string): DiagState {
  return {
    id,
    startedAt: Date.now(),
    cache: { hit: 0, miss: 0, singleflight: 0 },
    rpcs: [],
    sequentialHints: 0,
    parallelBatches: 0,
    notes: [],
  };
}

/** True only when the explicit flag is set and the app URL is staging. */
export function isBenchDiagEnabled(
  env: NodeJS.ProcessEnv = process.env
): { ok: boolean; reason: string } {
  if (env.REVUPILOT_APP_DIAG !== "1") {
    return { ok: false, reason: "REVUPILOT_APP_DIAG is not 1." };
  }
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const ref = projectRefFromSupabaseUrl(url);
  if (ref !== STAGING_SUPABASE_REF) {
    return {
      ok: false,
      reason: `Bench diag refuses project ref ${ref ?? "unknown"}; expected ${STAGING_SUPABASE_REF}.`,
    };
  }
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "Bench diag is disabled when NODE_ENV=production." };
  }
  return { ok: true, reason: "staging diag enabled" };
}

type RequestSlot = { state: DiagState | null };

/** One mutable slot per RSC request (React cache). */
const requestSlot = cache((): RequestSlot => ({ state: null }));

export function getBenchDiagStore(): DiagState | undefined {
  try {
    return requestSlot().state ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bind diagnostics for this RSC request when x-revupilot-bench-id is present
 * and diag is enabled. Safe no-op otherwise.
 */
function ensureStored(id: string): DiagState {
  const byId = diagMap();
  let state = byId.get(id);
  if (!state) {
    state = emptySnapshot(id);
    byId.set(id, state);
    if (byId.size > MAX_STORED) {
      const oldest = byId.keys().next().value;
      if (oldest) byId.delete(oldest);
    }
  }
  return state;
}

export async function enterBenchDiagFromHeaders(headerValue: string | null): Promise<void> {
  const gate = isBenchDiagEnabled();
  if (!gate.ok) return;
  if (!headerValue || !ID_RE.test(headerValue)) return;

  const state = ensureStored(headerValue);
  try {
    const slot = requestSlot();
    if (!slot.state) slot.state = state;
  } catch {
    // Outside RSC: byId entry alone still lets /api/bench/diag read RPC/cache
    // counts if something recorded against this id.
  }
}

/**
 * Bind RPC/cache events using the request header when React cache is unavailable
 * (e.g. some fetch callbacks). Safe under concurrency because it keys by id.
 */
export async function resolveBenchDiagFromHeaders(): Promise<DiagState | undefined> {
  const existing = getBenchDiagStore();
  if (existing) return existing;
  const gate = isBenchDiagEnabled();
  if (!gate.ok) return undefined;
  try {
    const { headers } = await import("next/headers");
    const id = (await headers()).get("x-revupilot-bench-id");
    if (!id || !ID_RE.test(id)) return undefined;
    const state = ensureStored(id);
    try {
      const slot = requestSlot();
      if (!slot.state) slot.state = state;
    } catch {
      /* ignore */
    }
    return state;
  } catch {
    return undefined;
  }
}

/** Sync entry used by tests (no React cache). */
export function enterBenchDiagFromHeadersSync(headerValue: string | null): void {
  const gate = isBenchDiagEnabled();
  if (!gate.ok) return;
  if (!headerValue || !ID_RE.test(headerValue)) return;
  const state = ensureStored(headerValue);
  try {
    requestSlot().state = state;
  } catch {
    // Outside RSC: keep global map only; tests use takeBenchDiag/peekBenchDiag.
  }
}

export function recordCacheEvent(event: BenchDiagCacheEvent): void {
  const state = getBenchDiagStore() ?? undefined;
  // Fallback: if React cache unavailable, last-registered byId entries are not
  // request-safe under concurrency — only record when request slot is bound.
  if (!state) return;
  state.cache[event] += 1;
}

export function recordRpc(name: string, ms: number, ok: boolean): void {
  const state = getBenchDiagStore();
  if (!state) return;
  if (state.rpcs.length < 80) {
    state.rpcs.push({ name: name.slice(0, 80), ms: Math.round(ms), ok });
  }
}

export function takeBenchDiag(id: string): BenchDiagSnapshot | null {
  const gate = isBenchDiagEnabled();
  if (!gate.ok) return null;
  if (!ID_RE.test(id)) return null;
  const byId = diagMap();
  const state = byId.get(id);
  if (!state) return null;
  byId.delete(id);
  return {
    ...state,
    cache: { ...state.cache },
    rpcs: state.rpcs.map((rpc) => ({ ...rpc })),
    notes: [...state.notes],
  };
}

/** Peek without deleting (debug). */
export function peekBenchDiag(id: string): BenchDiagSnapshot | null {
  if (!ID_RE.test(id)) return null;
  return diagMap().get(id) ?? null;
}

/** Test-only. */
export function resetBenchDiagForTests(): void {
  diagMap().clear();
}
