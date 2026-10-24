import { describe, expect, it } from "vitest";
import { formatFriendlyDate, formatFriendlyDateTime } from "@/lib/format-date";
import { formatPercent } from "@/lib/format";
import { starFillClass } from "@/components/star-rating";

describe("shared display formatters", () => {
  it("renders a share as a rounded percent or an em dash", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.426)).toBe("43%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("hides missing and invalid dates", () => {
    expect(formatFriendlyDate(null)).toBe("");
    expect(formatFriendlyDateTime(undefined)).toBe("");
    expect(formatFriendlyDate("not-a-date")).toBe("");
    expect(formatFriendlyDateTime("not-a-date", "2-digit")).toBe("");
  });

  it("keeps the year, and the two-digit hour only when asked", () => {
    const iso = new Date(2026, 9, 20, 13, 42).toISOString();
    expect(formatFriendlyDate(iso)).toContain("2026");
    expect(formatFriendlyDateTime(iso)).toContain("2026");
    expect(formatFriendlyDateTime(iso)).toContain("1:42");
    expect(formatFriendlyDateTime(iso, "2-digit")).toContain("01:42");
  });
});

describe("star fill", () => {
  it("uses the same sentiment colours as the inbox", () => {
    expect(starFillClass(5)).toBe("fill-green-500 text-green-500");
    expect(starFillClass(4)).toBe("fill-green-500 text-green-500");
    expect(starFillClass(3)).toBe("fill-yellow-400 text-yellow-500");
    expect(starFillClass(3.2)).toBe("fill-yellow-400 text-yellow-500");
    expect(starFillClass(2)).toBe("fill-red-500 text-red-500");
    expect(starFillClass(1)).toBe("fill-red-500 text-red-500");
  });
});
