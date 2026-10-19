import { describe, expect, it } from "vitest";
import { groupIdsInScope } from "@/lib/hierarchy";

describe("scope insight location resolution helpers", () => {
  it("includes a region and its city children when a group is selected", () => {
    const groups = [
      { id: "region-a", parentId: null },
      { id: "city-1", parentId: "region-a" },
      { id: "city-2", parentId: "region-a" },
      { id: "region-b", parentId: null },
    ];
    expect(groupIdsInScope("region-a", groups).sort()).toEqual(["city-1", "city-2", "region-a"]);
    expect(groupIdsInScope("city-1", groups)).toEqual(["city-1"]);
  });
});
