// =============================================================================
// GRM — Google API gate
//
// Google Business Profile allows ~300 queries/minute per Cloud project, shared
// by every customer. This module is the single choke point for calls to it:
//
//   - paces requests so the process stays under GOOGLE_API_RPM (default 200),
//   - lets interactive work (a user pressing Sync, publishing a reply) jump
//     ahead of background work (cron, onboarding imports),
//   - retries 429/5xx with exponential backoff + jitter, honouring Retry-After,
//   - when Google says 429, pauses *every* caller, not just the one that hit it.
//
// State is per Node process. That is correct for the single-container deploy
// in docker-compose.yml; with several app replicas, set GOOGLE_API_RPM to the
// project quota divided by the replica count.
// =============================================================================

import { AsyncLocalStorage } from "node:async_hooks";

export type GooglePriority = "interactive" | "background";

const priorityStore = new AsyncLocalStorage<GooglePriority>();

/** Runs `fn` so every Google call inside it is scheduled as interactive. */
export function withGooglePriority<T>(priority: GooglePriority, fn: () => Promise<T>): Promise<T> {
  return priorityStore.run(priority, fn);
}

export function currentGooglePriority(): GooglePriority {
  return priorityStore.getStore() ?? "background";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Requests per minute this process may send. 0 disables pacing (tests). */
function rpm(): number {
  return envInt("GOOGLE_API_RPM", 200);
}

/** First backoff step in ms. */
function retryBaseMs(): number {
  return envInt("GOOGLE_API_RETRY_BASE_MS", 1000);
}

const MAX_BACKOFF_MS = 30_000;

// Next free send slot per lane. Interactive ignores the background cursor so it
// is never queued behind a cron backlog; background yields to interactive.
let interactiveCursor = 0;
let backgroundCursor = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for this caller's turn. Resolves immediately when pacing is off. */
export async function acquireGoogleSlot(priority: GooglePriority = currentGooglePriority()): Promise<void> {
  const perMinute = rpm();
  if (perMinute <= 0) return;
  const interval = 60_000 / perMinute;
  const now = Date.now();
  let slot: number;
  if (priority === "interactive") {
    slot = Math.max(now, interactiveCursor);
    interactiveCursor = slot + interval;
    backgroundCursor = Math.max(backgroundCursor, interactiveCursor);
  } else {
    slot = Math.max(now, backgroundCursor);
    backgroundCursor = slot + interval;
  }
  if (slot > now) await sleep(slot - now);
}

/** Google told us to back off: nobody sends until `ms` from now. */
export function pauseGoogleCalls(ms: number): void {
  if (rpm() <= 0) return;
  const until = Date.now() + ms;
  interactiveCursor = Math.max(interactiveCursor, until);
  backgroundCursor = Math.max(backgroundCursor, until);
}

/** Retry-After header: delta-seconds or an HTTP date. Returns ms, or null. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Exponential backoff with full jitter: attempt 1 → ~base, 2 → ~2×base, … */
export function backoffMs(attempt: number, retryAfterMs: number | null, random = Math.random): number {
  const exp = Math.min(MAX_BACKOFF_MS, retryBaseMs() * 2 ** (attempt - 1));
  const jittered = exp / 2 + random() * (exp / 2);
  return Math.min(MAX_BACKOFF_MS, Math.max(jittered, retryAfterMs ?? 0));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export interface GoogleFetchOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  priority?: GooglePriority;
}

/**
 * fetch() through the gate. Retries 429/5xx and network failures; returns the
 * final Response (which may still be non-ok) or throws the last network error.
 * Callers keep their own error mapping.
 */
export async function googleFetch(
  url: string,
  init: RequestInit,
  { maxAttempts = 5, priority }: GoogleFetchOptions = {}
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    await acquireGoogleSlot(priority);
    let response: Response | null = null;
    let failure: unknown;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      failure = cause;
    }

    if (response && !isRetryableStatus(response.status)) return response;

    const retryAfter = response ? parseRetryAfter(response.headers.get("retry-after")) : null;
    if (attempt >= maxAttempts) {
      if (response) return response;
      throw failure;
    }

    const wait = backoffMs(attempt, retryAfter);
    // A 429 means the shared quota is spent: stop everyone, not just this call.
    if (response?.status === 429) pauseGoogleCalls(wait);
    await sleep(wait);
  }
}

/** Test helper: forget pacing state. */
export function resetGoogleGate(): void {
  interactiveCursor = 0;
  backgroundCursor = 0;
}
