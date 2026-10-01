import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Marker stored in grm_clients.notes for the system holding client. */
export const UNASSIGNED_CLIENT_MARKER = "grm:system:unassigned";

/**
 * Returns the workspace holding client for locations not yet mapped to a
 * real client. Idempotent: reuses the oldest Unassigned row and deactivates
 * any accidental duplicates.
 */
export async function ensureUnassignedClient(
  workspaceId: string
): Promise<{ id: string }> {
  const supabase = createAdminClient();

  const { data: rows, error: listError } = await supabase
    .from("grm_clients")
    .select("id, created_at, is_active")
    .eq("workspace_id", workspaceId)
    .eq("notes", UNASSIGNED_CLIENT_MARKER)
    .order("created_at", { ascending: true });

  if (listError) {
    throw new AppError(
      "Failed to load unassigned client pool",
      "DB_ERROR",
      500
    );
  }

  if (rows && rows.length > 0) {
    const canonical = rows[0];
    const duplicates = rows.slice(1);

    if (duplicates.length > 0) {
      const dupIds = duplicates.map((d) => d.id);

      // Move any locations pointing at duplicates onto the canonical pool
      await supabase
        .from("grm_google_locations")
        .update({ client_id: canonical.id })
        .eq("workspace_id", workspaceId)
        .in("client_id", dupIds);

      await supabase
        .from("grm_clients")
        .update({ is_active: false, name: "Unassigned (deprecated)" })
        .in("id", dupIds);

      logger.warn("unassigned.duplicates_collapsed", {
        workspaceId,
        canonicalId: canonical.id,
        deactivated: dupIds.length,
      });
    }

    if (!canonical.is_active) {
      await supabase
        .from("grm_clients")
        .update({ is_active: true, name: "Unassigned" })
        .eq("id", canonical.id);
    }

    return { id: canonical.id };
  }

  const { data: created, error } = await supabase
    .from("grm_clients")
    .insert({
      workspace_id: workspaceId,
      name: "Unassigned",
      notes: UNASSIGNED_CLIENT_MARKER,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Race: another request may have created it
    const { data: raced } = await supabase
      .from("grm_clients")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("notes", UNASSIGNED_CLIENT_MARKER)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (raced) return raced;
    throw new AppError(
      "Failed to create unassigned locations pool",
      "DB_ERROR",
      500
    );
  }

  return created;
}

export function isUnassignedClient(notes: string | null | undefined): boolean {
  return notes === UNASSIGNED_CLIENT_MARKER;
}

/** All Unassigned pool IDs for a workspace (active or not). */
export async function listUnassignedClientIds(
  workspaceId: string
): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("grm_clients")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("notes", UNASSIGNED_CLIENT_MARKER);
  return (data ?? []).map((r) => r.id);
}
