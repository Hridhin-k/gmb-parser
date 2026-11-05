export interface ProfileSyncResult {
  connectionId: string;
  error?: string;
  accountsUpserted?: number;
  locationsUpserted?: number;
  clientsCreated?: number;
  skippedGoogleFetch?: boolean;
}

/** Each login has its own request deadline and authorization check. Keep going after a failure. */
export async function syncGoogleConnections(
  connectionIds: string[],
  options: { force?: boolean; stage?: boolean } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<ProfileSyncResult[]> {
  const ids = [...new Set(connectionIds)];
  const results: ProfileSyncResult[] = [];
  for (const connectionId of ids) {
    onProgress?.(results.length, ids.length);
    try {
      const response = await fetch("/api/google/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, ...options }), signal: AbortSignal.timeout(70_000),
      });
      const payload = await response.json() as Omit<ProfileSyncResult, "connectionId">;
      results.push({ ...payload, connectionId,
        ...(!response.ok ? { error: payload.error ?? "Google could not sync this account. Please try again." } : {}),
      });
    } catch {
      results.push({ connectionId, error: "No response received. Check this account’s profiles before retrying." });
    }
    onProgress?.(results.length, ids.length);
  }
  return results;
}
