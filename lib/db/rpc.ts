import type { createAdminClient } from "@/lib/db/client";

type Admin = ReturnType<typeof createAdminClient>;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(message: string | undefined) {
  if (!message) return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket/i.test(message);
}

/** Read-only location stats with a short retry for a transient connection error. */
export async function rpcLocationReviewStats(admin: Admin, workspaceId: string) {
  let last = await admin.rpc("grm_location_review_stats", { p_workspace_id: workspaceId });
  for (let attempt = 0; attempt < 2 && last.error && isTransientFetchError(last.error.message); attempt++) {
    await sleep(400 * (attempt + 1));
    last = await admin.rpc("grm_location_review_stats", { p_workspace_id: workspaceId });
  }
  return last;
}
