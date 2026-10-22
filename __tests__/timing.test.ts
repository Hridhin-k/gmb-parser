import { describe, expect, it } from "vitest";
import { serverTimingHeader } from "@/lib/timing";

describe("serverTimingHeader", () => {
  it("formats name;dur entries", () => {
    expect(
      serverTimingHeader([
        ["proxy-auth", 12.4],
        ["proxy", 20],
      ])
    ).toBe("proxy-auth;dur=12, proxy;dur=20");
  });

  it("clamps negative durations to zero", () => {
    expect(serverTimingHeader([["x", -3]])).toBe("x;dur=0");
  });
});
