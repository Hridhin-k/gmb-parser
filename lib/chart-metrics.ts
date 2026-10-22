/**
 * Metrics that sit next to every graph. Each value is computed from the
 * exact series the graph draws — same rows, same buckets — so a number
 * under a chart can always be traced back to a mark inside it. Nothing
 * here estimates, samples, or annualises.
 */

export interface MonthlySeriesPoint {
  label: string;
  positive: number;
  negative: number;
  /** 3★ reviews for volume charts; omitted for observation trends. */
  neutral?: number;
  avgRating?: number | null;
}

export interface MonthlySeriesMetrics {
  /** Sum of positive + neutral + negative across the displayed months. */
  total: number;
  positive: number;
  negative: number;
  /** Months that contain at least one item. */
  monthsWithData: number;
  /** total ÷ months in the displayed series (including empty months). */
  averagePerMonth: number;
  peak: { label: string; total: number } | null;
  /**
   * positive ÷ (positive + negative + neutral). For observation trends
   * (no neutral) this is the share of praise-vs-complaint mentions.
   */
  positiveShare: number | null;
  /**
   * positiveShare of the last month with data minus that of the first
   * month with data, in percentage points. Null when either end has no
   * positive/negative items to form a share.
   */
  positiveShareChangePoints: number | null;
  peakNegative: { label: string; negative: number } | null;
  latest: { label: string; total: number; positive: number; negative: number } | null;
  /** Review-weighted mean of the monthly averages: Σ(avg × n) ÷ Σn. */
  weightedAvgRating: number | null;
}

function pointTotal(point: MonthlySeriesPoint): number {
  return point.positive + point.negative + (point.neutral ?? 0);
}

function share(positive: number, negative: number, neutral: number): number | null {
  const base = positive + negative + neutral;
  return base > 0 ? positive / base : null;
}

export function monthlySeriesMetrics(points: MonthlySeriesPoint[]): MonthlySeriesMetrics {
  let positive = 0;
  let negative = 0;
  let total = 0;
  let monthsWithData = 0;
  let peak: MonthlySeriesMetrics["peak"] = null;
  let peakNegative: MonthlySeriesMetrics["peakNegative"] = null;
  let latest: MonthlySeriesMetrics["latest"] = null;
  let ratingWeightedSum = 0;
  let ratingWeight = 0;

  for (const point of points) {
    const t = pointTotal(point);
    positive += point.positive;
    negative += point.negative;
    total += t;
    if (t > 0) {
      monthsWithData += 1;
      latest = { label: point.label, total: t, positive: point.positive, negative: point.negative };
    }
    if (t > 0 && (peak === null || t > peak.total)) peak = { label: point.label, total: t };
    if (point.negative > 0 && (peakNegative === null || point.negative > peakNegative.negative)) {
      peakNegative = { label: point.label, negative: point.negative };
    }
    if (point.avgRating !== null && point.avgRating !== undefined && t > 0) {
      ratingWeightedSum += point.avgRating * t;
      ratingWeight += t;
    }
  }

  const neutralTotal = total - positive - negative;
  const withShare = points.filter((p) => share(p.positive, p.negative, p.neutral ?? 0) !== null);
  const firstShare = withShare.length
    ? share(withShare[0]!.positive, withShare[0]!.negative, withShare[0]!.neutral ?? 0)
    : null;
  const lastShare = withShare.length
    ? share(
        withShare[withShare.length - 1]!.positive,
        withShare[withShare.length - 1]!.negative,
        withShare[withShare.length - 1]!.neutral ?? 0
      )
    : null;

  return {
    total,
    positive,
    negative,
    monthsWithData,
    averagePerMonth: points.length > 0 ? total / points.length : 0,
    peak,
    positiveShare: share(positive, negative, neutralTotal),
    positiveShareChangePoints:
      firstShare !== null && lastShare !== null ? (lastShare - firstShare) * 100 : null,
    peakNegative,
    latest,
    weightedAvgRating: ratingWeight > 0 ? ratingWeightedSum / ratingWeight : null,
  };
}

export interface BucketMetrics {
  total: number;
  /** Largest bucket and its share of the total; null when total is 0. */
  largest: { label: string; value: number; share: number } | null;
}

/** Totals for labelled buckets (bar distributions such as reply time). */
export function bucketMetrics(rows: Array<{ label: string; value: number }>): BucketMetrics {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let largest: BucketMetrics["largest"] = null;
  for (const row of rows) {
    if (total > 0 && (largest === null || row.value > largest.value)) {
      largest = { label: row.label, value: row.value, share: row.value / total };
    }
  }
  return { total, largest };
}
