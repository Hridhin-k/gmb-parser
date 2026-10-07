import { describe, expect, it } from "vitest";
import {
  formatLocationOption,
  locationBrand,
  locationDisplayName,
  locationPlaceLabel,
  readableStoreCode,
} from "@/lib/ui/location-place";

describe("locationPlaceLabel", () => {
  it.each([
    ["Salem-Ernakulam Highway, Angamaly, Ernakulam, Kerala, 683572, IN", "Angamaly, Ernakulam"],
    ["Polayathodu, Kollam, Kerala, 691010, IN", "Polayathodu, Kollam"],
    ["Lal Bahadur Shastri road, Kottayam, Kerala, 686001, IN", "Kottayam"],
    [
      "Opp. Ramavarma District Club, general hospital junction, F8RQ+Q94,, Alappuzha, Kerala, Alappuzha, Kerala, 688011, IN",
      "Alappuzha",
    ],
    ["Stadium Bypass Rd, Sultanpet, Palakkad, Kerala, 678013, IN", "Sultanpet, Palakkad"],
    [
      "Building No. 20/17/A,  Alengadan Heights, Irinjalakuda Main Road, Thrissur, Kerala, 680121, IN",
      "Irinjalakuda, Thrissur",
    ],
    [
      "Emmatty Towers, St Thomas College Road, East Fort, Pallikkulam, Thrissur, Kerala, 680001, IN",
      "Pallikkulam, Thrissur",
    ],
    ["East Fort Road, Statue Junction, Thrippunithura, Kochi, Kerala, 682301, IN", "Thrippunithura, Kochi"],
    ["F7P2+3X4, Padavarad, Ollur, Thrissur, Kerala, 680306, IN", "Ollur, Thrissur"],
  ])("%s → %s", (address, expected) => {
    expect(locationPlaceLabel({ storeCode: "12266160996918245031", address })).toBe(expected);
  });

  it("falls back to a human store code when there is no address", () => {
    expect(locationPlaceLabel({ storeCode: "FAZ-TCR", address: null })).toBe("FAZ-TCR");
  });

  it("never shows a Google-generated numeric store code", () => {
    expect(locationPlaceLabel({ storeCode: "10168253048224919230", address: null })).toBeNull();
  });
});

describe("readableStoreCode", () => {
  it("keeps codes people chose and drops numeric ids", () => {
    expect(readableStoreCode("FAZ-KTYM")).toBe("FAZ-KTYM");
    expect(readableStoreCode("06936392301318726207")).toBeNull();
  });
});

describe("locationBrand", () => {
  it("drops the SEO tail of a Google title", () => {
    expect(locationBrand("nuhome | Thrissur’s Largest Interior Products Showroom")).toBe("nuhome");
    expect(locationBrand("Norms Management (Pvt) Ltd - ESI, PF, Labour Law Consultancy")).toBe(
      "Norms Management (Pvt) Ltd"
    );
    expect(locationBrand("Salem-Ernakulam Store")).toBe("Salem-Ernakulam Store");
  });
});

describe("locationDisplayName", () => {
  it("names Fazyo shops by area and district", () => {
    expect(
      locationDisplayName({
        title: "Fazyo",
        storeCode: "12266160996918245031",
        address: "Salem-Ernakulam Highway, Angamaly, Ernakulam, Kerala, 683572, IN",
      })
    ).toBe("Fazyo Angamaly, Ernakulam");
  });

  it("does not repeat a place already in the brand", () => {
    expect(
      locationDisplayName({
        title: "Fitnesszone Thrissur",
        address: "opposite Lourdh Church Thrissur, Thrissur, Kerala, 680006, IN",
      })
    ).toBe("Fitnesszone Thrissur");
  });

  it("is used for filter options", () => {
    expect(
      formatLocationOption({
        brand: "Fazyo",
        title: "Fazyo",
        storeCode: "FAZ-KTYM",
        address: "Lal Bahadur Shastri road, Kottayam, Kerala, 686001, IN",
      })
    ).toBe("Fazyo Kottayam");
  });
});
