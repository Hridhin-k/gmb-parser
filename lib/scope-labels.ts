import { locationDisplayName } from "@/lib/ui/location-place";

export interface ScopeChoiceLabelInput {
  kind: "client" | "group" | "location";
  name: string;
  brand?: string | null;
  group?: string | null;
  storeCode?: string | null;
  address?: string | null;
}

/** Brand, group, and store labels that stay distinct when names repeat. */
export function scopeChoiceLabel(input: ScopeChoiceLabelInput): string {
  if (input.kind === "client") return input.name;
  if (input.kind === "group") {
    return input.brand ? `${input.brand} · ${input.name}` : input.name;
  }
  const place = locationDisplayName({
    title: input.name,
    brand: input.brand,
    storeCode: input.storeCode,
    address: input.address,
  });
  if (input.group && !place.toLowerCase().includes(input.group.toLowerCase())) {
    return `${input.group} · ${place}`;
  }
  return place;
}

const KIND_PREFIX = { client: "Brand", group: "Group", location: "Store" } as const;

/** Identical names get a kind, then a number, so two chips are not the same text. */
export function disambiguateScopeLabels<T extends { label: string; kind: "client" | "group" | "location" }>(
  choices: T[]
): T[] {
  const counts = new Map<string, number>();
  for (const choice of choices) counts.set(choice.label, (counts.get(choice.label) ?? 0) + 1);
  const prefixed = choices.map((choice) => {
    if ((counts.get(choice.label) ?? 0) < 2) return choice;
    return { ...choice, label: `${KIND_PREFIX[choice.kind]} · ${choice.label}` };
  });
  const seen = new Map<string, number>();
  return prefixed.map((choice) => {
    const next = (seen.get(choice.label) ?? 0) + 1;
    seen.set(choice.label, next);
    if (next === 1) return choice;
    return { ...choice, label: `${choice.label} (${next})` };
  });
}
