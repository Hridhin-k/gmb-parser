/**
 * Readable names for shops that share a brand (e.g. ten Fazyo locations):
 * "Fazyo Angamaly, Ernakulam" instead of a Google store code like
 * "12266160996918245031".
 *
 * address_formatted is built as
 * "<addressLines…>, <locality>, <administrativeArea>, <postalCode>, <regionCode>".
 */

const REGION_CODE = /^[A-Z]{2}$/;
const POSTAL_CODE = /^\d{4,}$/;
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;
/** Address-line parts that are streets, buildings, or landmarks rather than an area name. */
const NOT_AN_AREA =
  /\d|\b(road|rd|street|lane|highway|bypass|avenue|building|bldg|floor|tower|towers|apartments?|complex|plaza|mall|heights|silks|opp|opposite|near|behind|junction|bus stand|no)\b\.?/i;
/** A long purely numeric store code is a Google-generated id, not something people recognise. */
const MACHINE_STORE_CODE = /^\d{8,}$/;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function titleCaseIfLower(s: string): string {
  return s === s.toLowerCase() ? s.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : s;
}

export function readableStoreCode(storeCode?: string | null): string | null {
  const code = storeCode ? clean(storeCode) : "";
  return code && !MACHINE_STORE_CODE.test(code) ? code : null;
}

/** "Angamaly, Ernakulam", or just "Kottayam" when the address has no clear area. */
export function locationPlaceLabel(input: {
  storeCode?: string | null;
  address?: string | null;
}): string | null {
  const parts = (input.address ?? "")
    .split(",")
    .map(clean)
    .filter((p) => p && !REGION_CODE.test(p) && !POSTAL_CODE.test(p));

  if (parts.length < 2) {
    return parts[0] ? titleCaseIfLower(parts[0]) : readableStoreCode(input.storeCode);
  }

  const state = parts[parts.length - 1];
  const locality = parts[parts.length - 2];

  let area: string | null = null;
  for (let i = parts.length - 3; i >= 0; i--) {
    const part = parts[i];
    if (same(part, state) || same(part, locality) || PLUS_CODE.test(part)) continue;
    const town = part.match(/^(.+?)\s+main\s+road$/i)?.[1];
    if (town && !NOT_AN_AREA.test(town)) area = town;
    else if (!NOT_AN_AREA.test(part)) area = part;
    break;
  }

  const place = area ? `${titleCaseIfLower(area)}, ${titleCaseIfLower(locality)}` : titleCaseIfLower(locality);
  return place;
}

/** Brand part of a Google title: "nuhome | Thrissur's Largest…" → "nuhome". */
export function locationBrand(title: string): string {
  const brand = clean(title.split(/\s+[|–—-]\s+/)[0] ?? title);
  return brand || clean(title);
}

/** "Fazyo Angamaly, Ernakulam". Skips place words the brand already contains. */
export function locationDisplayName(input: {
  title: string;
  brand?: string | null;
  storeCode?: string | null;
  address?: string | null;
}): string {
  const brand = locationBrand(input.brand?.trim() || input.title);
  const place = locationPlaceLabel(input);
  if (!place) return brand;

  const brandLower = brand.toLowerCase();
  const extra = place
    .split(", ")
    .filter((p) => !brandLower.includes(p.toLowerCase()))
    .join(", ");
  return extra ? `${brand} ${extra}` : brand;
}

export function formatLocationOption(input: {
  brand?: string | null;
  title: string;
  storeCode?: string | null;
  address?: string | null;
}): string {
  return locationDisplayName(input);
}
