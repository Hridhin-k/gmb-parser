/**
 * In-memory progress for an in-app "Update summary" run, keyed by
 * workspace. The run itself stays a single synchronous request; this
 * store only lets the page poll and render progress while it waits.
 * On multi-instance deployments a poll may land on another instance and
 * report idle — the UI then shows an indeterminate state, never wrong
 * numbers.
 */
export type BackfillPhase = "extracting" | "embedding" | "merging" | "regenerating" | "done" | "failed";

export interface BackfillProgress {
  clientId: string | null;
  phase: BackfillPhase;
  pendingBefore: number;
  processed: number;
  rulesStored: number;
  batchStored: number;
  remaining: number;
  notice: string | null;
  startedAt: string;
  updatedAt: string;
}

const runs = new Map<string, BackfillProgress>();

export function setBackfillProgress(workspaceId: string, progress: Omit<BackfillProgress, "updatedAt">): void {
  runs.set(workspaceId, { ...progress, updatedAt: new Date().toISOString() });
}

const ACTIVE_PHASES: readonly BackfillPhase[] = ["extracting", "embedding", "merging", "regenerating"];
/** An active run that has not reported progress for this long is treated as abandoned. */
const STALE_RUN_MS = 20 * 60 * 1000;

/**
 * Starts a run only when no other run is active for the workspace.
 * Two browser tabs (or a double click) must not start overlapping runs:
 * they would share one progress display and double-spend model calls.
 * Returns false when an active run already owns the workspace.
 */
export function tryStartBackfill(workspaceId: string, progress: Omit<BackfillProgress, "updatedAt">): boolean {
  const current = runs.get(workspaceId);
  if (current && ACTIVE_PHASES.includes(current.phase)) {
    const age = Date.now() - new Date(current.updatedAt).getTime();
    if (Number.isFinite(age) && age < STALE_RUN_MS) return false;
  }
  runs.set(workspaceId, { ...progress, updatedAt: new Date().toISOString() });
  return true;
}

export function patchBackfillProgress(workspaceId: string, patch: Partial<BackfillProgress>): void {
  const current = runs.get(workspaceId);
  if (!current) return;
  runs.set(workspaceId, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

export function getBackfillProgress(workspaceId: string, clientId?: string | null): BackfillProgress | null {
  const current = runs.get(workspaceId);
  if (!current) return null;
  if (clientId && current.clientId && current.clientId !== clientId) return null;
  return current;
}

export function clearBackfillProgress(workspaceId: string): void {
  runs.delete(workspaceId);
}
