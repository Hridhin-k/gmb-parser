/**
 * Labelled complaints used to choose a join threshold and to check the gates.
 * Topics are the leaf set a correct extraction would store. Wording differs
 * inside a group. Billing delays and staff delays stay in different groups.
 */
export interface EvalReview {
  id: string;
  text: string;
  topics: string[];
  group: "fitting-clean" | "billing" | "staff" | "floor" | "rare";
  locationId: string;
  createdAt: string;
  severity: "none" | "low" | "moderate" | "high";
  workspaceId: string;
}

export const CLUSTER_EVAL_REVIEWS: EvalReview[] = [
  {
    id: "fit-1",
    text: "The trial room was dirty.",
    topics: ["cleanliness", "fitting_room"],
    group: "fitting-clean",
    locationId: "loc-a",
    createdAt: "2026-08-02T10:00:00.000Z",
    severity: "moderate",
    workspaceId: "ws-1",
  },
  {
    id: "fit-2",
    text: "Fitting rooms need better cleaning.",
    topics: ["cleanliness", "fitting_room"],
    group: "fitting-clean",
    locationId: "loc-b",
    createdAt: "2026-08-11T10:00:00.000Z",
    severity: "low",
    workspaceId: "ws-1",
  },
  {
    id: "fit-3",
    text: "The changing area was unhygienic.",
    topics: ["cleanliness", "fitting_room"],
    group: "fitting-clean",
    locationId: "loc-a",
    createdAt: "2026-09-03T10:00:00.000Z",
    severity: "moderate",
    workspaceId: "ws-1",
  },
  {
    id: "bill-1",
    text: "Billing took forever at the counter.",
    topics: ["billing_delay"],
    group: "billing",
    locationId: "loc-a",
    createdAt: "2026-08-05T10:00:00.000Z",
    severity: "low",
    workspaceId: "ws-1",
  },
  {
    id: "bill-2",
    text: "The checkout queue was very slow.",
    topics: ["billing_delay"],
    group: "billing",
    locationId: "loc-b",
    createdAt: "2026-08-18T10:00:00.000Z",
    severity: "moderate",
    workspaceId: "ws-1",
  },
  {
    id: "staff-1",
    text: "Staff took too long to respond.",
    topics: ["staff_availability"],
    group: "staff",
    locationId: "loc-a",
    createdAt: "2026-08-06T10:00:00.000Z",
    severity: "moderate",
    workspaceId: "ws-1",
  },
  {
    id: "staff-2",
    text: "Nobody came to help for ages.",
    topics: ["staff_availability"],
    group: "staff",
    locationId: "loc-c",
    createdAt: "2026-09-08T10:00:00.000Z",
    severity: "moderate",
    workspaceId: "ws-1",
  },
  {
    id: "floor-1",
    text: "The floor near the entrance was dirty.",
    topics: ["cleanliness"],
    group: "floor",
    locationId: "loc-a",
    createdAt: "2026-08-09T10:00:00.000Z",
    severity: "low",
    workspaceId: "ws-1",
  },
  {
    id: "rare-1",
    text: "A loose tile in the trial room is a safety hazard.",
    topics: ["fitting_room"],
    group: "rare",
    locationId: "loc-c",
    createdAt: "2026-09-12T10:00:00.000Z",
    severity: "high",
    workspaceId: "ws-1",
  },
];

export interface ThresholdChoice {
  join: number;
  separated: boolean;
  gap: number;
  minPositive: number;
  maxNegative: number;
}

/**
 * Join threshold is the midpoint between the weakest pair that should match
 * and the strongest pair that should not, when those ranges do not overlap.
 * If they overlap, the threshold stays at the weakest true pair and
 * `separated` is false: the model cannot carry the decision alone.
 */
export function chooseJoinThreshold(positive: readonly number[], negative: readonly number[]): ThresholdChoice {
  if (positive.length === 0) throw new Error("config: no positive pairs to choose a threshold");
  const minPositive = Math.min(...positive);
  const maxNegative = negative.length > 0 ? Math.max(...negative) : minPositive - 0.05;
  const separated = minPositive > maxNegative;
  const join = separated ? Number(((minPositive + maxNegative) / 2).toFixed(4)) : Number(minPositive.toFixed(4));
  return {
    join,
    separated,
    gap: Number((minPositive - maxNegative).toFixed(4)),
    minPositive: Number(minPositive.toFixed(4)),
    maxNegative: Number(maxNegative.toFixed(4)),
  };
}
