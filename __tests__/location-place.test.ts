import { describe, expect, it } from "vitest";
import {
  formatLocationOption,
  locationPlaceLabel,
} from "@/lib/ui/location-place";

describe("locationPlaceLabel", () => {
  it("prefers store code", () => {
    expect(
      locationPlaceLabel({
        storeCode: "FAZ-KTYM",
        address: "MG Road, Kottayam, Kerala",
      })
    ).toBe("FAZ-KTYM");
  });

  it("uses the city from a long address when there is no store code", () => {
    expect(
      locationPlaceLabel({
        storeCode: null,
        address: "Shop 12, Baker Junction, Kottayam, Kerala 686001, India",
      })
    ).toBe("Kottayam, Kerala 686001");
  });
});

describe("formatLocationOption", () => {
  it("shows brand and place so Fazyo shops are distinct", () => {
    expect(
      formatLocationOption({
        brand: "Fazyo",
        title: "Fazyo",
        storeCode: "FAZ-TCR",
        address: null,
      })
    ).toBe("Fazyo · FAZ-TCR");
  });
});
