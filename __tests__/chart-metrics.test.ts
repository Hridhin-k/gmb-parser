import { describe, expect, it } from "vitest";
import { bucketMetrics, monthlySeriesMetrics } from "@/lib/chart-metrics";

describe("monthlySeriesMetrics", () => {
  it("computes totals, peak, shares and the review-weighted rating from the drawn series", () => {
    const m = monthlySeriesMetrics([
      { label: "Jan", positive: 40, negative: 10, neutral: 10, avgRating: 4.0 },
      { label: "Feb", positive: 10, negative: 30, neutral: 0, avgRating: 3.0 },
      { label: "Mar", positive: 0, negative: 0, neutral: 0, avgRating: null },
    ]);
    expect(m.total).toBe(100);
    expect(m.positive).toBe(50);
    expect(m.negative).toBe(40);
    expect(m.monthsWithData).toBe(2);
    expect(m.averagePerMonth).toBeCloseTo(100 / 3);
    expect(m.peak).toEqual({ label: "Jan", total: 60 });
    expect(m.peakNegative).toEqual({ label: "Feb", negative: 30 });
    // Latest month WITH data is Feb, not the empty Mar bucket.
    expect(m.latest).toEqual({ label: "Feb", total: 40, positive: 10, negative: 30 });
    expect(m.positiveShare).toBeCloseTo(50 / 100);
    // Weighted: (4.0×60 + 3.0×40) ÷ 100 = 3.6, not the naive mean 3.5.
    expect(m.weightedAvgRating).toBeCloseTo(3.6);
  });

  it("reports the positive-share change between first and last month with data, in points", () => {
    const m = monthlySeriesMetrics([
      { label: "Jan", positive: 75, negative: 25 },
      { label: "Feb", positive: 25, negative: 75 },
    ]);
    // Observation-trend shape (no neutral): share is of praise+complaint.
    expect(m.positiveShare).toBeCloseTo(0.5);
    expect(m.positiveShareChangePoints).toBeCloseTo(-50);
  });

  it("handles an empty / all-zero series without inventing numbers", () => {
    const m = monthlySeriesMetrics([
      { label: "Jan", positive: 0, negative: 0, neutral: 0, avgRating: null },
    ]);
    expect(m.total).toBe(0);
    expect(m.peak).toBeNull();
    expect(m.peakNegative).toBeNull();
    expect(m.latest).toBeNull();
    expect(m.positiveShare).toBeNull();
    expect(m.positiveShareChangePoints).toBeNull();
    expect(m.weightedAvgRating).toBeNull();
    expect(monthlySeriesMetrics([]).averagePerMonth).toBe(0);
  });
});

describe("bucketMetrics", () => {
  it("totals buckets and names the largest with its true share", () => {
    const m = bucketMetrics([
      { label: "< 1h", value: 30 },
      { label: "1–24h", value: 60 },
      { label: "> 24h", value: 10 },
    ]);
    expect(m.total).toBe(100);
    expect(m.largest).toEqual({ label: "1–24h", value: 60, share: 0.6 });
  });

  it("returns no largest bucket when everything is zero", () => {
    expect(bucketMetrics([{ label: "a", value: 0 }]).largest).toBeNull();
  });
});
