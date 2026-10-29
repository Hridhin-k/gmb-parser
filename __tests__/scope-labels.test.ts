import { describe, expect, it } from "vitest";
import { disambiguateScopeLabels, scopeChoiceLabel } from "@/lib/scope-labels";

describe("scope choice labels", () => {
  it("puts the brand and group in front of a store", () => {
    expect(
      scopeChoiceLabel({
        kind: "location",
        name: "Fazyo",
        brand: "Fazyo",
        group: "Ernakulam",
        address: "Angamaly, Ernakulam, Kerala, 683572, IN",
      })
    ).toContain("Ernakulam");
  });

  it("prefixes a brand and a store that share a name", () => {
    const labels = disambiguateScopeLabels([
      { id: "c1", kind: "client" as const, label: "Downtown" },
      { id: "l1", kind: "location" as const, label: "Downtown" },
    ]);
    expect(labels.map((item) => item.label)).toEqual(["Brand · Downtown", "Store · Downtown"]);
  });
});
