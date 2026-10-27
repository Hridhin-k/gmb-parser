import { createHash } from "node:crypto";

/** Volumes the runner will seed. Larger volumes need an explicit opt-in. */
export const REVIEW_VOLUMES = [100_000, 250_000, 1_000_000, 10_000_000, 50_000_000] as const;

/** Tenant counts requested for the capacity envelope. */
export const TENANT_COUNTS = [100, 250, 500] as const;

export const BENCH_USER_ID = "b1111111-1111-4111-8111-111111111111";

/** Fixed lexicon. No names, emails, phone numbers, or customer text. */
export const PHRASES = [
  "The queue at the counter moved slowly.",
  "Staff at the till were polite and quick.",
  "The shelves were tidy and the aisles were clear.",
  "A product on the shelf was damaged.",
  "Checkout took longer than the sign promised.",
  "The fitting room was clean and well lit.",
  "Prices on the shelf matched the receipt.",
  "The shop floor was crowded near the entrance.",
] as const;

/** Share of reviews that receive a comment. Close to the live written share of 36.5%. */
export const TEXT_RATE = 0.37;

/** Rough average comment size used only for a disk estimate, not a measurement. */
export const ESTIMATED_TEXT_BYTES = 160;

export const DEFAULT_SEED = 20261027;
export const DEFAULT_BATCH_SIZE = 20_000;
export const LARGE_DATASET_FROM = 10_000_000;
export const SAMPLE_ANALYSIS_PERCENT = 2;

export type AnalysesMode = "full" | "sample" | "none";

export type BenchLocation = {
  id: string;
  clientId: string;
  groupId: string;
};

export type BenchClient = {
  clientId: string;
  brandId: string;
  regionId: string;
  cityId: string;
};

export type BenchTenant = {
  index: number;
  reviews: number;
  reviewOffset: number;
  locations: number;
  clients: BenchClient[];
  locationRows: BenchLocation[];
  workspaceId: string;
  connectionId: string;
  accountId: string;
};

export type BenchPlan = {
  seed: number;
  tenants: number;
  reviews: number;
  analyses: AnalysesMode;
  samplePercent: number;
  batchSize: number;
  userId: string;
  phrases: readonly string[];
  rows: BenchTenant[];
  deviations: string[];
  estimates: {
    commentBytes: number;
    analysisRows: number;
    observationRows: number;
    replyRows: number;
  };
};

export type ReviewBatch = {
  tenantIndex: number;
  from: number;
  to: number;
  globalEnd: number;
};

export function benchUuid(parts: string): string {
  const hex = createHash("md5").update(`revupilot-bench:${parts}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function reviewName(seed: number, tenantIndex: number, reviewIndex: number): string {
  return `bench/${seed}/t${String(tenantIndex).padStart(4, "0")}/r${String(reviewIndex).padStart(12, "0")}`;
}

export function workspaceSlug(seed: number, tenantIndex: number): string {
  return `bench-${seed}-${String(tenantIndex).padStart(4, "0")}`;
}

/**
 * Unequal tenant sizes. The first three tenants take 40%, 15%, and 8%.
 * The rest follow a Zipf curve. Counts are a pure function of tenant count
 * and total reviews, so a seed change does not reshuffle the volume plan.
 */
export function allocateReviews(tenantCount: number, totalReviews: number): number[] {
  if (!Number.isInteger(tenantCount) || tenantCount < 1) {
    throw new Error("tenant count must be a positive integer");
  }
  if (!Number.isInteger(totalReviews) || totalReviews < 1) {
    throw new Error("review count must be a positive integer");
  }
  const counts = new Array<number>(tenantCount).fill(0);
  const head = Math.min(3, tenantCount);
  const shares = [0.4, 0.15, 0.08];
  let assigned = 0;
  for (let i = 0; i < head; i += 1) {
    counts[i] = Math.floor(totalReviews * shares[i]);
    assigned += counts[i];
  }
  const remaining = totalReviews - assigned;
  const rest = tenantCount - head;
  if (rest === 0) {
    counts[0] += remaining;
    return counts;
  }
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < rest; i += 1) {
    const weight = 1 / (i + 1) ** 1.1;
    weights.push(weight);
    weightSum += weight;
  }
  let given = 0;
  for (let i = 0; i < rest; i += 1) {
    const count = Math.floor((remaining * weights[i]) / weightSum);
    counts[head + i] = count;
    given += count;
  }
  counts[0] += remaining - given;
  return counts;
}

export function locationCount(reviews: number): number {
  if (reviews <= 0) return 2;
  return Math.min(80, Math.max(2, Math.round(Math.sqrt(reviews) / 40)));
}

export function clientCount(reviews: number): number {
  return reviews >= 100_000 ? 3 : 1;
}

export function analysesModeFor(totalReviews: number, requested?: AnalysesMode): AnalysesMode {
  if (requested) return requested;
  return totalReviews <= 1_000_000 ? "full" : "sample";
}

export function assertSupportedShape(tenantCount: number, totalReviews: number): void {
  if (!(TENANT_COUNTS as readonly number[]).includes(tenantCount)) {
    throw new Error(`tenant count must be one of ${TENANT_COUNTS.join(", ")}`);
  }
  if (!(REVIEW_VOLUMES as readonly number[]).includes(totalReviews)) {
    throw new Error(`review volume must be one of ${REVIEW_VOLUMES.join(", ")}`);
  }
}

export function buildPlan(input: {
  seed?: number;
  tenants: number;
  reviews: number;
  analyses?: AnalysesMode;
  batchSize?: number;
}): BenchPlan {
  assertSupportedShape(input.tenants, input.reviews);
  const seed = input.seed ?? DEFAULT_SEED;
  const analyses = analysesModeFor(input.reviews, input.analyses);
  if (input.reviews >= LARGE_DATASET_FROM && analyses === "full") {
    // The caller must have already opted in. The plan records the cost.
  }
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const allocated = allocateReviews(input.tenants, input.reviews);
  let reviewOffset = 0;
  const rows: BenchTenant[] = allocated.map((reviews, index) => {
    const locations = locationCount(reviews);
    const clientsN = clientCount(reviews);
    const clients: BenchClient[] = [];
    for (let c = 0; c < clientsN; c += 1) {
      clients.push({
        clientId: benchUuid(`${seed}:t${index}:client:${c}`),
        brandId: benchUuid(`${seed}:t${index}:brand:${c}`),
        regionId: benchUuid(`${seed}:t${index}:region:${c}`),
        cityId: benchUuid(`${seed}:t${index}:city:${c}`),
      });
    }
    const locationRows: BenchLocation[] = [];
    for (let loc = 0; loc < locations; loc += 1) {
      const client = clients[loc % clients.length];
      locationRows.push({
        id: benchUuid(`${seed}:t${index}:location:${loc}`),
        clientId: client.clientId,
        groupId: client.cityId,
      });
    }
    const row: BenchTenant = {
      index,
      reviews,
      reviewOffset,
      locations,
      clients,
      locationRows,
      workspaceId: benchUuid(`${seed}:workspace:${index}`),
      connectionId: benchUuid(`${seed}:connection:${index}`),
      accountId: benchUuid(`${seed}:account:${index}`),
    };
    reviewOffset += reviews;
    return row;
  });

  const written = Math.round(input.reviews * TEXT_RATE);
  const analysisRows =
    analyses === "none" ? 0 : analyses === "full" ? written : Math.round(written * (SAMPLE_ANALYSIS_PERCENT / 100));
  const deviations = [
    "Review text comes from an eight-sentence fixture lexicon. It is not customer content.",
    "Google connections are stored as revoked placeholders. The suite never calls Google or Gemini.",
    "Review primary keys are assigned by Postgres on first insert. google_review_name is the reproducible key.",
    "A tenant below 100,000 reviews has one client. A larger tenant has three clients, each with a region and a city.",
    "Locations per tenant are between 2 and 80, from the square root of that tenant's review count.",
    "About 37% of reviews have text. About one in sixteen has an update time two days after create.",
    "Comment length stays under roughly 500 characters.",
    analyses === "full"
      ? "Every written review gets one ready analysis and one observation."
      : analyses === "sample"
        ? `Analyses and observations cover about ${SAMPLE_ANALYSIS_PERCENT}% of written reviews. Full analysis above 1,000,000 reviews is opt-in because of disk use.`
        : "Analysis and observation rows are skipped.",
    input.reviews < 1_000_000
      ? "No tenant has 100,000 reviews at this volume. That size is reserved for datasets of 1,000,000 reviews or more so the other tenants still have data."
      : "The largest tenant holds about 40% of reviews and is above 100,000.",
    "Timed queries run as the database owner, which bypasses row-level security. Each read carries a workspace predicate and a foreign-row counter.",
    "Observation evidence is the fixture sentence copied from the review. The bench process discards GEMINI_API_KEY before it connects and never calls Gemini.",
  ];

  return {
    seed,
    tenants: input.tenants,
    reviews: input.reviews,
    analyses,
    samplePercent: analyses === "sample" ? SAMPLE_ANALYSIS_PERCENT : analyses === "full" ? 100 : 0,
    batchSize,
    userId: BENCH_USER_ID,
    phrases: PHRASES,
    rows,
    deviations,
    estimates: {
      commentBytes: Math.round(input.reviews * TEXT_RATE * ESTIMATED_TEXT_BYTES),
      analysisRows,
      observationRows: analysisRows,
      replyRows: Math.round(input.reviews * 0.02),
    },
  };
}

export function reviewBatches(plan: Pick<BenchPlan, "rows" | "batchSize">, completedThrough = 0): ReviewBatch[] {
  const batches: ReviewBatch[] = [];
  for (const tenant of plan.rows) {
    if (tenant.reviews === 0) continue;
    for (let from = 0; from < tenant.reviews; from += plan.batchSize) {
      const to = Math.min(tenant.reviews, from + plan.batchSize) - 1;
      const globalEnd = tenant.reviewOffset + to + 1;
      if (globalEnd <= completedThrough) continue;
      batches.push({ tenantIndex: tenant.index, from, to, globalEnd });
    }
  }
  return batches;
}

export function planSummary(plan: BenchPlan): {
  largest: number;
  smallest: number;
  zeroTenants: number;
  locations: number;
  maxLocations: number;
} {
  const sizes = plan.rows.map((row) => row.reviews);
  return {
    largest: Math.max(...sizes),
    smallest: Math.min(...sizes),
    zeroTenants: sizes.filter((size) => size === 0).length,
    locations: plan.rows.reduce((sum, row) => sum + row.locations, 0),
    maxLocations: Math.max(...plan.rows.map((row) => row.locations)),
  };
}
