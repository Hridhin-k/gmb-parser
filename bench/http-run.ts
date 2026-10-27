/**
 * Phase 4 — authenticated application HTTP harness (staging / loopback only).
 *
 * Usage:
 *   REVUPILOT_APP_DIAG=1 \
 *   BENCH_CONFIRM=staging \
 *   BENCH_HTTP_BASE_URL=http://127.0.0.1:3000 \
 *   BENCH_HTTP_COOKIE_FILE=/tmp/revupilot-cookie-cdp.json \
 *   BENCH_HTTP_CLIENT_ID=… BENCH_HTTP_GROUP_ID=… BENCH_HTTP_LOCATION_ID=… \
 *   npx tsx bench/http-run.ts [--baseline|--cache|--concurrency|--isolation|--all]
 *
 * Optional second identity:
 *   BENCH_HTTP_COOKIE_FILE_B=/path/to/workspace-b-cookies.json
 *
 * Never prints cookies, tokens, or review bodies. Production is refused.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PRODUCTION_REF, STAGING_REF } from "./safety";
import { decideHttpTarget, loadCookieHeader } from "./http-safety";
import { buildHttpRoutes, concurrencyMix, type HttpRouteDef } from "./http-routes";
import { percentile, summarize, type LatencySample } from "./metrics";

type RequestClass = "document" | "redirect" | "login_html" | "error" | "other";

type HttpSample = {
  routeId: string;
  path: string;
  class: RequestClass;
  status: number;
  ok: boolean;
  timedOut: boolean;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  cold: boolean;
  serverTiming: string;
  redirectLocation?: string;
  cache?: { hit: number; miss: number; singleflight: number };
  rpcCount?: number;
  rpcs?: Array<{ name: string; ms: number; ok: boolean }>;
  error?: string;
};

type RunConfig = {
  baseUrl: string;
  jarA: CookieJar;
  jarB: CookieJar | null;
  cookieBReason: string | null;
  scopes: { clientId?: string; groupId?: string; locationId?: string };
  timeoutMs: number;
  maxDurationMs: number;
  samplesPerRoute: number;
  concurrencyLevels: number[];
  concurrencySamples: number;
  modes: Set<string>;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function parseArgs(argv: string[]): Set<string> {
  const modes = new Set<string>();
  for (const arg of argv) {
    if (arg === "--all") {
      modes.add("baseline");
      modes.add("cache");
      modes.add("concurrency");
      modes.add("isolation");
      continue;
    }
    if (arg.startsWith("--")) modes.add(arg.slice(2));
  }
  if (modes.size === 0) {
    modes.add("baseline");
    modes.add("cache");
    modes.add("concurrency");
    modes.add("isolation");
  }
  return modes;
}

function loadEnvLocalSupabaseUrl(): string {
  try {
    const text = require("node:fs").readFileSync(resolve(process.cwd(), ".env.local"), "utf8") as string;
    const match = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(text);
    return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  } catch {
    return env("NEXT_PUBLIC_SUPABASE_URL");
  }
}

function classify(status: number, body: Buffer, contentType: string | null): RequestClass {
  if (status >= 300 && status < 400) return "redirect";
  const textStart = body.subarray(0, Math.min(body.length, 4000)).toString("utf8");
  if (status === 200 && /name=["']email["']/i.test(textStart) && /password/i.test(textStart)) {
    return "login_html";
  }
  if (status >= 400) return "error";
  if (contentType?.includes("text/html")) return "document";
  return "other";
}

function benchId(): string {
  return `b${randomBytes(12).toString("hex")}`;
}

/** Mutable cookie jar — applies Set-Cookie name/value pairs without logging values. */
class CookieJar {
  private map = new Map<string, string>();

  constructor(header: string) {
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      this.map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }

  header(): string {
    return [...this.map.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorbSetCookie(response: Response): void {
    const anyHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    const lines =
      typeof anyHeaders.getSetCookie === "function"
        ? anyHeaders.getSetCookie()
        : (() => {
            const single = response.headers.get("set-cookie");
            return single ? [single] : [];
          })();
    for (const line of lines) {
      const first = line.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;
      const expired = /Max-Age=0/i.test(line) || /Expires=Thu, 01 Jan 1970/i.test(line);
      // Keep staging auth cookies unless the server explicitly expires them.
      // Empty Set-Cookie values during refresh must not wipe the jar mid-suite.
      if (expired) this.map.delete(name);
      else if (value === "") continue;
      else this.map.set(name, value);
    }
  }

  names(): string[] {
    return [...this.map.keys()];
  }
}

function safeRedirectPath(location: string | null, baseUrl: string): string | undefined {
  if (!location) return undefined;
  try {
    const absolute = new URL(location, baseUrl);
    // Path + search only — never log intermediate auth fragments.
    return `${absolute.pathname}${absolute.search}`;
  } catch {
    return undefined;
  }
}

async function fetchOnce(input: {
  baseUrl: string;
  path: string;
  jar: CookieJar;
  timeoutMs: number;
  routeId: string;
  cold: boolean;
  withDiag: boolean;
}): Promise<HttpSample> {
  const id = benchId();
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml",
    Cookie: input.jar.header(),
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  if (input.withDiag) headers["x-revupilot-bench-id"] = id;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), input.timeoutMs);
  const t0 = performance.now();
  let ttfbMs = 0;
  try {
    let url = new URL(input.path, input.baseUrl);
    let response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: ac.signal,
    });
    ttfbMs = performance.now() - t0;
    input.jar.absorbSetCookie(response);

    // Follow a few same-origin hops for scope normalization. Login redirects stay failures.
    let redirectLocation = safeRedirectPath(response.headers.get("location"), input.baseUrl);
    for (let hop = 0; hop < 3; hop++) {
      if (
        !(response.status === 307 || response.status === 302 || response.status === 303) ||
        !redirectLocation ||
        redirectLocation.startsWith("/login")
      ) {
        break;
      }
      headers.Cookie = input.jar.header();
      url = new URL(redirectLocation, input.baseUrl);
      response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: ac.signal,
      });
      input.jar.absorbSetCookie(response);
      if (!ttfbMs) ttfbMs = performance.now() - t0;
      redirectLocation = safeRedirectPath(response.headers.get("location"), input.baseUrl) ?? redirectLocation;
    }

    const body = Buffer.from(await response.arrayBuffer());
    const totalMs = performance.now() - t0;
    const contentType = response.headers.get("content-type");
    const serverTiming = response.headers.get("server-timing") ?? "";
    const requestClass = classify(response.status, body, contentType);
    const sample: HttpSample = {
      routeId: input.routeId,
      path: input.path,
      class: requestClass,
      status: response.status,
      ok: response.status === 200 && requestClass === "document",
      timedOut: false,
      ttfbMs: Math.round(ttfbMs),
      totalMs: Math.round(totalMs),
      bytes: body.length,
      cold: input.cold,
      serverTiming: serverTiming.slice(0, 240),
      redirectLocation,
    };

    if (requestClass === "redirect" && redirectLocation?.startsWith("/login")) {
      sample.error = "auth_redirect_login";
    }

    if (input.withDiag && sample.ok) {
      try {
        const diagUrl = new URL(`/api/bench/diag?id=${encodeURIComponent(id)}`, input.baseUrl);
        const diagRes = await fetch(diagUrl, {
          headers: { Cookie: input.jar.header(), Accept: "application/json" },
          signal: AbortSignal.timeout(Math.min(10_000, input.timeoutMs)),
        });
        input.jar.absorbSetCookie(diagRes);
        if (diagRes.ok) {
          const diag = (await diagRes.json()) as {
            cache?: HttpSample["cache"];
            rpcCount?: number;
            rpcs?: HttpSample["rpcs"];
          };
          sample.cache = diag.cache;
          sample.rpcCount = diag.rpcCount;
          sample.rpcs = diag.rpcs;
        }
      } catch {
        /* diag is best-effort */
      }
    }
    return sample;
  } catch (error) {
    const totalMs = performance.now() - t0;
    const timedOut = error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
    return {
      routeId: input.routeId,
      path: input.path,
      class: "error",
      status: 0,
      ok: false,
      timedOut,
      ttfbMs: Math.round(ttfbMs || totalMs),
      totalMs: Math.round(totalMs),
      bytes: 0,
      cold: input.cold,
      serverTiming: "",
      error: timedOut ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function toLatencySamples(samples: HttpSample[]): LatencySample[] {
  return samples.map((sample) => ({
    workload: sample.routeId,
    ms: sample.totalMs,
    ok: sample.ok,
    cold: sample.cold,
    bytes: sample.bytes,
    timedOut: sample.timedOut,
  }));
}

function summarizeRoute(samples: HttpSample[]) {
  const warm = samples.filter((sample) => !sample.cold);
  const cold = samples.filter((sample) => sample.cold);
  const okWarm = warm.filter((sample) => sample.ok);
  const totals = okWarm.map((sample) => sample.totalMs);
  const ttfbs = okWarm.map((sample) => sample.ttfbMs);
  const inconclusive = okWarm.length < 20;
  return {
    requests: samples.length,
    ok: samples.filter((sample) => sample.ok).length,
    errors: samples.filter((sample) => !sample.ok).length,
    timeouts: samples.filter((sample) => sample.timedOut).length,
    login_html: samples.filter((sample) => sample.class === "login_html").length,
    redirects: samples.filter((sample) => sample.class === "redirect").length,
    cold: cold.map((sample) => ({
      status: sample.status,
      ttfbMs: sample.ttfbMs,
      totalMs: sample.totalMs,
      bytes: sample.bytes,
      cache: sample.cache,
      rpcCount: sample.rpcCount,
    })),
    warm: {
      n: okWarm.length,
      inconclusive,
      totalMs: {
        p50: percentile(totals, 0.5),
        p95: percentile(totals, 0.95),
        p99: percentile(totals, 0.99),
      },
      ttfbMs: {
        p50: percentile(ttfbs, 0.5),
        p95: percentile(ttfbs, 0.95),
        p99: percentile(ttfbs, 0.99),
      },
      bytesP95: percentile(
        okWarm.map((sample) => sample.bytes),
        0.95
      ),
      cacheHits: okWarm.reduce((sum, sample) => sum + (sample.cache?.hit ?? 0), 0),
      cacheMisses: okWarm.reduce((sum, sample) => sum + (sample.cache?.miss ?? 0), 0),
      rpcCountAvg:
        okWarm.filter((sample) => sample.rpcCount != null).length === 0
          ? null
          : Math.round(
              (okWarm.reduce((sum, sample) => sum + (sample.rpcCount ?? 0), 0) /
                okWarm.filter((sample) => sample.rpcCount != null).length) *
                10
            ) / 10,
    },
  };
}

async function runBaseline(
  cfg: RunConfig,
  routes: HttpRouteDef[],
  withDiag: boolean
): Promise<{ samples: HttpSample[]; byRoute: Record<string, ReturnType<typeof summarizeRoute>> }> {
  const samples: HttpSample[] = [];
  for (const route of routes) {
    // One cold sample (process may already be warm from earlier routes — labeled cold for first hit of this path in this run).
    samples.push(
      await fetchOnce({
        baseUrl: cfg.baseUrl,
        path: route.path,
        jar: cfg.jarA,
        timeoutMs: cfg.timeoutMs,
        routeId: route.id,
        cold: true,
        withDiag,
      })
    );
    for (let i = 0; i < cfg.samplesPerRoute; i++) {
      samples.push(
        await fetchOnce({
          baseUrl: cfg.baseUrl,
          path: route.path,
          jar: cfg.jarA,
          timeoutMs: cfg.timeoutMs,
          routeId: route.id,
          cold: false,
          withDiag: withDiag && i === 0,
        })
      );
    }
  }
  const byRoute: Record<string, ReturnType<typeof summarizeRoute>> = {};
  for (const route of routes) {
    byRoute[route.id] = summarizeRoute(samples.filter((sample) => sample.routeId === route.id));
  }
  return { samples, byRoute };
}

async function runCacheScenarios(
  cfg: RunConfig,
  routes: HttpRouteDef[],
  withDiag: boolean
): Promise<Record<string, unknown>> {
  const overview = routes.find((route) => route.id === "overview_30d");
  const analytics = routes.find((route) => route.id === "analytics_performance_30d");
  const location = routes.find((route) => route.id === "overview_location_30d");
  if (!overview) return { error: "overview_30d missing" };

  const hit = async (route: HttpRouteDef, cold: boolean) =>
    fetchOnce({
      baseUrl: cfg.baseUrl,
      path: route.path,
      jar: cfg.jarA,
      timeoutMs: cfg.timeoutMs,
      routeId: route.id,
      cold,
      withDiag,
    });

  const A = await hit(overview, true);
  const B = await hit(overview, false);
  const E = location ? await hit(location, true) : null;
  const sameFiltersOtherPath = analytics ? await hit(analytics, true) : null;

  // Cross-workspace collision probe: only when cookie B exists.
  let D: HttpSample | { untested: string } = {
    untested: "BENCH_HTTP_COOKIE_FILE_B not provided — second workspace identity required.",
  };
  if (cfg.jarB) {
    D = await fetchOnce({
      baseUrl: cfg.baseUrl,
      path: overview.path,
      jar: cfg.jarB,
      timeoutMs: cfg.timeoutMs,
      routeId: `${overview.id}_workspace_b`,
      cold: true,
      withDiag,
    });
  }

  return {
    A_cold_empty_or_process_local: {
      status: A.status,
      ok: A.ok,
      totalMs: A.totalMs,
      cache: A.cache,
      rpcCount: A.rpcCount,
      note: "Cold relative to this scenario; process cache may retain earlier baseline entries until TTL/invalidate.",
    },
    B_warm_within_ttl: {
      status: B.status,
      ok: B.ok,
      totalMs: B.totalMs,
      cache: B.cache,
      rpcCount: B.rpcCount,
      fasterThanCold: A.ok && B.ok ? B.totalMs < A.totalMs : null,
      evidence:
        B.cache && B.cache.hit > 0
          ? "diag reported cache hits on warm request"
          : B.ok && B.totalMs + 50 < A.totalMs
            ? "warm faster than cold (suggests cache or connection reuse); diag hits unavailable or zero"
            : "inconclusive without diag hits",
    },
    C_after_invalidate: {
      untested:
        "No narrowly approved staging write was executed in this phase; invalidation covered by unit tests (__tests__/dashboard-cache.test.ts) and Phase 3 notes.",
    },
    D_different_workspace: D,
    E_different_scope: E
      ? { status: E.status, ok: E.ok, totalMs: E.totalMs, cache: E.cache, path: E.path }
      : { untested: "location scope id not configured" },
    F_second_instance: {
      untested: "Single local Next.js process; process-local cache is not distributed.",
    },
    G_after_sync_or_reply_write: {
      untested: "Mutation path not exercised (safety: avoid staging writes unless approved).",
    },
    same_filters_analytics_tab: sameFiltersOtherPath
      ? {
          status: sameFiltersOtherPath.status,
          ok: sameFiltersOtherPath.ok,
          totalMs: sameFiltersOtherPath.totalMs,
          cache: sameFiltersOtherPath.cache,
        }
      : null,
    cookieB: cfg.jarB ? "configured" : cfg.cookieBReason,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function runConcurrency(
  cfg: RunConfig,
  mix: HttpRouteDef[],
  startedAt: number
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const level of cfg.concurrencyLevels) {
    if (Date.now() - startedAt > cfg.maxDurationMs) {
      out.stopped = "max duration reached before remaining concurrency levels";
      break;
    }
    const jobs: Array<{ route: HttpRouteDef; n: number }> = [];
    for (let i = 0; i < cfg.concurrencySamples; i++) {
      jobs.push({ route: mix[i % mix.length], n: i });
    }
    const t0 = performance.now();
    // Per-worker jars so concurrent Set-Cookie updates do not race one map.
    const workerJars = Array.from({ length: level }, () => new CookieJar(cfg.jarA.header()));
    let workerCursor = 0;
    const samples = await mapPool(jobs, level, async (job) => {
      const jar = workerJars[workerCursor++ % workerJars.length];
      return fetchOnce({
        baseUrl: cfg.baseUrl,
        path: job.route.path,
        jar,
        timeoutMs: cfg.timeoutMs,
        routeId: job.route.id,
        cold: false,
        withDiag: false,
      });
    });
    const elapsedMs = performance.now() - t0;
    const summary = summarize(toLatencySamples(samples), elapsedMs);
    const byRoute: Record<string, ReturnType<typeof summarizeRoute>> = {};
    for (const route of mix) {
      byRoute[route.id] = summarizeRoute(samples.filter((sample) => sample.routeId === route.id));
    }
    const stop =
      summary.errorRate >= 0.05
        ? `error rate ${(summary.errorRate * 100).toFixed(1)}%`
        : summary.timeouts >= 3
          ? "timeout stop"
          : null;
    out[`c${level}`] = {
      concurrency: level,
      mix: mix.map((route) => route.id),
      elapsedMs: Math.round(elapsedMs),
      summary,
      byRoute,
      inconclusive: cfg.concurrencySamples < 20,
      sampleNote:
        cfg.concurrencySamples < 20
          ? "Sample count below 20 — treat p95/p99 as inconclusive."
          : "Sample count may still be thin per-route; see byRoute.n.",
    };
    if (stop) {
      out.stopped = stop;
      break;
    }
  }
  return out;
}

async function runIsolation(cfg: RunConfig, routes: HttpRouteDef[]): Promise<Record<string, unknown>> {
  const overview = routes.find((route) => route.id === "overview_30d")!;
  const foreignWorkspace = env("BENCH_HTTP_FOREIGN_WORKSPACE_ID") || "46698a41-fc64-49cd-8e5e-a912207230ee";
  const foreignClient = env("BENCH_HTTP_FOREIGN_CLIENT_ID");

  const aHome = await fetchOnce({
    baseUrl: cfg.baseUrl,
    path: overview.path,
    jar: cfg.jarA,
    timeoutMs: cfg.timeoutMs,
    routeId: "iso_a_home",
    cold: false,
    withDiag: false,
  });

  // Query-param workspace bypass attempts are not a first-class URL feature;
  // probe foreign client/group/location ids instead.
  const probes: HttpSample[] = [];
  if (foreignClient) {
    probes.push(
      await fetchOnce({
        baseUrl: cfg.baseUrl,
        path: `/overview?range=1m&client=${foreignClient}`,
        jar: cfg.jarA,
        timeoutMs: cfg.timeoutMs,
        routeId: "iso_a_foreign_client",
        cold: false,
        withDiag: false,
      })
    );
  } else {
    // Use a random UUID that should not be in workspace A.
    probes.push(
      await fetchOnce({
        baseUrl: cfg.baseUrl,
        path: `/overview?range=1m&client=${foreignWorkspace}`,
        jar: cfg.jarA,
        timeoutMs: cfg.timeoutMs,
        routeId: "iso_a_invalid_client",
        cold: false,
        withDiag: false,
      })
    );
  }

  let workspaceB: Record<string, unknown> = {
    untested: cfg.cookieBReason ?? "Second authenticated identity not configured.",
    required:
      "Set BENCH_HTTP_COOKIE_FILE_B to a CDP cookie dump for a user who is a member of a different workspace only. Obtain the session via normal /login against staging — do not forge cookies.",
  };
  if (cfg.jarB) {
    const bHome = await fetchOnce({
      baseUrl: cfg.baseUrl,
      path: overview.path,
      jar: cfg.jarB,
      timeoutMs: cfg.timeoutMs,
      routeId: "iso_b_home",
      cold: true,
      withDiag: true,
    });
    workspaceB = {
      ok: bHome.ok,
      status: bHome.status,
      bytes: bHome.bytes,
      note: "Body content is not compared (PII). Cross-tenant proof requires distinct workspace membership and empty/unauthorized foreign scope probes.",
    };
  }

  return {
    workspaceA_home: { ok: aHome.ok, status: aHome.status, bytes: aHome.bytes },
    foreign_scope_probes: probes.map((sample) => ({
      routeId: sample.routeId,
      status: sample.status,
      ok: sample.ok,
      class: sample.class,
      bytes: sample.bytes,
      note:
        sample.ok && sample.bytes > 50_000
          ? "Page rendered — scope must be validated empty/notFound by app; inspect manually if counts look foreign."
          : "Safe failure or small payload",
    })),
    workspaceB,
    unit_tests: "Also run: npx vitest run __tests__/dashboard-cache.test.ts __tests__/tenant-api-isolation.test.ts __tests__/access.test.ts",
    privileged_diag_without_flag: "Expected 404 when REVUPILOT_APP_DIAG unset (covered in unit tests).",
  };
}

function buildConfig(argv: string[]): RunConfig {
  const modes = parseArgs(argv);
  const supabaseUrl = loadEnvLocalSupabaseUrl();
  const decision = decideHttpTarget({
    baseUrl: env("BENCH_HTTP_BASE_URL") || "http://127.0.0.1:3000",
    confirm: env("BENCH_CONFIRM"),
    supabaseUrl,
    allowAppHost: env("BENCH_HTTP_ALLOW_HOST"),
  });
  if (!decision.ok) {
    throw new Error(decision.reason);
  }

  const cookieFile = env("BENCH_HTTP_COOKIE_FILE") || "/tmp/revupilot-cookie-cdp.json";
  const cookieA = loadCookieHeader(cookieFile);
  if (!cookieA.ok) throw new Error(cookieA.reason);

  let jarB: CookieJar | null = null;
  let cookieBReason: string | null = "BENCH_HTTP_COOKIE_FILE_B not set.";
  const cookieFileB = env("BENCH_HTTP_COOKIE_FILE_B");
  if (cookieFileB) {
    const loaded = loadCookieHeader(cookieFileB);
    if (!loaded.ok) cookieBReason = loaded.reason;
    else {
      jarB = new CookieJar(loaded.cookieHeader);
      cookieBReason = null;
    }
  }

  return {
    baseUrl: decision.baseUrl!,
    jarA: new CookieJar(cookieA.cookieHeader),
    jarB,
    cookieBReason,
    scopes: {
      clientId: env("BENCH_HTTP_CLIENT_ID") || undefined,
      groupId: env("BENCH_HTTP_GROUP_ID") || undefined,
      locationId: env("BENCH_HTTP_LOCATION_ID") || undefined,
    },
    timeoutMs: Number(env("BENCH_HTTP_TIMEOUT_MS") || 120_000),
    maxDurationMs: Number(env("BENCH_HTTP_MAX_MS") || 25 * 60_000),
    samplesPerRoute: Number(env("BENCH_HTTP_SAMPLES") || 7),
    concurrencyLevels: (env("BENCH_HTTP_CONCURRENCY") || "1,5,10,20")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => n > 0),
    concurrencySamples: Number(env("BENCH_HTTP_CONCURRENCY_SAMPLES") || 40),
    modes,
  };
}

async function main() {
  const startedAt = Date.now();
  const cfg = buildConfig(process.argv.slice(2));
  const withDiag = process.env.REVUPILOT_APP_DIAG === "1";
  const routes = buildHttpRoutes(cfg.scopes);
  const mix = concurrencyMix(routes);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(process.cwd(), "bench/results/staging-scale");
  mkdirSync(outDir, { recursive: true });

  const report: Record<string, unknown> = {
    phase: 4,
    generatedAt: new Date().toISOString(),
    stagingRef: STAGING_REF,
    productionTouched: false,
    productionRefRefused: PRODUCTION_REF,
    environment: {
      baseUrl: cfg.baseUrl,
      supabaseRef: STAGING_REF,
      diagEnabled: withDiag,
      cookieA: "configured (values redacted)",
      cookieB: cfg.jarB ? "configured (values redacted)" : cfg.cookieBReason,
      scopes: {
        clientId: cfg.scopes.clientId ? "[set]" : null,
        groupId: cfg.scopes.groupId ? "[set]" : null,
        locationId: cfg.scopes.locationId ? "[set]" : null,
      },
      samplesPerRoute: cfg.samplesPerRoute,
      concurrencyLevels: cfg.concurrencyLevels,
      concurrencySamples: cfg.concurrencySamples,
      note:
        cfg.samplesPerRoute < 20
          ? "Baseline warm samples per route < 20 — label p95 inconclusive."
          : "Baseline sample count may still be modest; see per-route warm.inconclusive.",
    },
    routeMap: routes,
    limitations: [
      "SQL Phase 1–3 latencies are not page latencies.",
      "Process-local TTL cache is per Node instance; no distributed invalidation.",
      "createAdminClient uses service_role; tenant isolation is enforced in application loaders, not RLS on these reads.",
      "Prefetch and static assets are not counted as page loads.",
      "Second application instance (scenario F) not available on single local next dev.",
      "Write/invalidate scenarios C and G untested at HTTP layer unless narrowly approved.",
    ],
  };

  const reseedJarA = () => {
    const cookieFile = env("BENCH_HTTP_COOKIE_FILE") || "/tmp/revupilot-cookie-cdp.json";
    const loaded = loadCookieHeader(cookieFile);
    if (!loaded.ok) throw new Error(loaded.reason);
    cfg.jarA = new CookieJar(loaded.cookieHeader);
  };

  if (cfg.modes.has("baseline")) {
    process.stderr.write("phase4: baseline…\n");
    const baseline = await runBaseline(cfg, routes, withDiag);
    report.baseline = {
      byRoute: baseline.byRoute,
      sampleCount: baseline.samples.length,
      rawFile: `phase4-http-baseline-samples-${stamp}.json`,
    };
    writeFileSync(
      resolve(outDir, `phase4-http-baseline-samples-${stamp}.json`),
      JSON.stringify(
        baseline.samples.map((sample) => ({
          ...sample,
          // never persist bodies; samples already exclude them
        })),
        null,
        2
      )
    );
  }

  if (cfg.modes.has("cache")) {
    reseedJarA();
    process.stderr.write("phase4: cache scenarios…\n");
    report.cacheScenarios = await runCacheScenarios(cfg, routes, withDiag);
  }

  if (cfg.modes.has("concurrency")) {
    reseedJarA();
    process.stderr.write("phase4: concurrency…\n");
    report.concurrency = await runConcurrency(cfg, mix, startedAt);
  }

  if (cfg.modes.has("isolation")) {
    reseedJarA();
    process.stderr.write("phase4: isolation…\n");
    report.isolation = await runIsolation(cfg, routes);
  }

  report.elapsedMs = Date.now() - startedAt;
  const reportPath = resolve(outDir, `phase4-http-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ reportFile: reportPath, productionTouched: false })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
