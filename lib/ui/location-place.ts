/** Distinguishes shops that share a brand name (e.g. ten Fazyo locations). */
export function locationPlaceLabel(input: {
  storeCode?: string | null;
  address?: string | null;
}): string | null {
  const code = input.storeCode?.replace(/\s+/g, " ").trim();
  if (code) return code;

  const address = input.address?.replace(/\s+/g, " ").trim();
  if (!address) return null;

  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(-3, -1).join(", ");
  if (parts.length === 2) return parts[0];
  return address.length > 56 ? `${address.slice(0, 53)}…` : address;
}

export function formatLocationOption(input: {
  brand?: string | null;
  title: string;
  storeCode?: string | null;
  address?: string | null;
}): string {
  const place = locationPlaceLabel(input);
  const brand = input.brand?.trim();
  if (place && brand) return `${brand} · ${place}`;
  if (place) return `${input.title} · ${place}`;
  return input.title;
}
