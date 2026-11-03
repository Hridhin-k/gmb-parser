import { describe, expect, it } from "vitest";
import { settingsRedirect } from "@/lib/settings-redirect";

describe("settingsRedirect", () => {
  it("sends an old page to its Settings section", () => {
    expect(settingsRedirect("team", {})).toBe("/settings?section=team");
  });

  it("keeps every filter, scope and period param", () => {
    expect(
      settingsRedirect("security", { action: "reply.published", page: "2", range: "3m", client: "c1" })
    ).toBe("/settings?section=security&action=reply.published&page=2&range=3m&client=c1");
  });

  it("keeps repeated params and drops a stray section", () => {
    expect(settingsRedirect("plan", { section: "tone", tag: ["a", "b"], empty: undefined })).toBe(
      "/settings?section=plan&tag=a&tag=b"
    );
  });
});
