import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { csvCell, csvRow } from "@/lib/services/review-export";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Great service")).toBe("Great service");
    expect(csvCell(5)).toBe("5");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvCell("Good, fast")).toBe('"Good, fast"');
    expect(csvCell('They said "wow"')).toBe('"They said ""wow"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 call me")).toBe("'+1 call me");
    expect(csvCell("@admin")).toBe("'@admin");
  });
});

describe("csvRow", () => {
  it("joins cells with commas", () => {
    expect(csvRow(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"');
  });
});
