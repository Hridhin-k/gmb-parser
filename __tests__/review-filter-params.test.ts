import { describe, expect, it } from "vitest";
import {
  parseAllowedParams,
  parseRatingParams,
  parseStatusParams,
  serializeParamValues,
  splitParamValues,
  statusFilterOperand,
  statusOrFilter,
} from "@/lib/review-filter-params";

describe("splitParamValues", () => {
  it("splits comma lists and repeated params, deduping in order", () => {
    expect(splitParamValues("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(splitParamValues(["a", "b,a"])).toEqual(["a", "b"]);
    expect(splitParamValues(undefined)).toEqual([]);
    expect(splitParamValues("")).toEqual([]);
  });
});

describe("parseStatusParams", () => {
  it("keeps known statuses and drops all/unknown", () => {
    expect(parseStatusParams("unanswered,draft")).toEqual(["unanswered", "draft"]);
    expect(parseStatusParams("all")).toEqual([]);
    expect(parseStatusParams("bogus,failed")).toEqual(["failed"]);
  });
});

describe("parseRatingParams", () => {
  it("keeps 1–5 integers, highest first", () => {
    expect(parseRatingParams("1,5,3,5,9,x")).toEqual([5, 3, 1]);
    expect(parseRatingParams("4")).toEqual([4]);
    expect(parseRatingParams(undefined)).toEqual([]);
  });
});

describe("parseAllowedParams / serializeParamValues", () => {
  it("round-trips allowed values only", () => {
    const parsed = parseAllowedParams("en,xx,ml", ["en", "ml"]);
    expect(parsed).toEqual(["en", "ml"]);
    expect(serializeParamValues(parsed)).toBe("en,ml");
    expect(serializeParamValues([])).toBeNull();
  });
});

describe("statusOrFilter", () => {
  it("is null for zero or one status", () => {
    expect(statusOrFilter([])).toBeNull();
    expect(statusOrFilter(["draft"])).toBeNull();
  });

  it("ORs statuses, including nested conditions", () => {
    expect(statusOrFilter(["unanswered", "draft"])).toBe(
      "reply_status.eq.none,reply_status.eq.draft"
    );
    expect(statusOrFilter(["escalated", "published"])).toBe(
      "and(star_rating.lte.3,reply_status.in.(none,draft,failed)),reply_status.eq.published"
    );
  });

  it("ignores unknown statuses", () => {
    expect(statusOrFilter(["bogus", "also-bogus"])).toBeNull();
    expect(statusOrFilter(["bogus", "draft", "failed"])).toBe(
      "reply_status.eq.draft,reply_status.eq.failed"
    );
  });

  it("maps single statuses to operands", () => {
    expect(statusFilterOperand("answered")).toBe("reply_status.neq.none");
    expect(statusFilterOperand("approved")).toBe("reply_status.in.(approved,pending_publish)");
    expect(statusFilterOperand("nope")).toBeNull();
  });
});
