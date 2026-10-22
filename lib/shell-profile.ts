import type { ShellProfileAttention } from "@/lib/shell";

export interface ShellProfileCount {
  locationId: string;
  unreplied: number;
  drafts: number;
  failed: number;
  escalations: number;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Turns the `grm_shell_profile_attention` JSON into per-location counts. */
export function parseShellProfileCounts(raw: unknown): ShellProfileCount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.locationId !== "string" || row.locationId.length === 0) return [];
    return [
      {
        locationId: row.locationId,
        unreplied: num(row.unreplied),
        drafts: num(row.drafts),
        failed: num(row.failed),
        escalations: num(row.escalations),
      },
    ];
  });
}

export function mergeProfileAttention(
  counts: ShellProfileCount[],
  names: Map<string, string>
): ShellProfileAttention[] {
  return counts
    .map((count) => ({
      id: count.locationId,
      name: names.get(count.locationId) || "Profile",
      unreplied: count.unreplied,
      escalations: count.escalations,
      drafts: count.drafts,
      failed: count.failed,
    }))
    .filter((profile) => profile.unreplied + profile.escalations + profile.drafts + profile.failed > 0);
}
