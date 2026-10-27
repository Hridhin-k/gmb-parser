import type { createAdminClient } from "@/lib/supabase/admin";
import { estimateCostUsd, monthKey, monthlyBudgetUsd, type AiOperation } from "@/lib/ai-usage";
import { logger } from "@/lib/logger";

type Admin = ReturnType<typeof createAdminClient>;

export interface AiBudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  exceeded: boolean;
  /** False when the ledger table is not installed yet. Budget checks then pass open. */
  tracked: boolean;
}

/**
 * Best-effort spend accounting in grm_ai_usage_monthly (migration
 * 20261020011). Accounting must never fail a generation, so every database
 * error is logged and swallowed.
 */
export async function recordAiUsage(
  admin: Admin,
  entry: {
    workspaceId: string;
    operation: AiOperation;
    model: string;
    inputTokens: number;
    outputTokens: number;
    calls?: number;
    batch?: boolean;
  }
): Promise<void> {
  try {
    const month = monthKey();
    const cost = estimateCostUsd(entry.model, entry.inputTokens, entry.outputTokens, entry.batch);
    const { data: existing, error: readError } = await admin
      .from("grm_ai_usage_monthly")
      .select("calls, input_tokens, output_tokens, estimated_usd")
      .eq("workspace_id", entry.workspaceId)
      .eq("month", month)
      .eq("operation", entry.operation)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const payload = {
      workspace_id: entry.workspaceId,
      month,
      operation: entry.operation,
      calls: (existing?.calls ?? 0) + (entry.calls ?? 1),
      input_tokens: (existing?.input_tokens ?? 0) + entry.inputTokens,
      output_tokens: (existing?.output_tokens ?? 0) + entry.outputTokens,
      estimated_usd: Number(((existing?.estimated_usd ?? 0) + cost).toFixed(6)),
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await admin
          .from("grm_ai_usage_monthly")
          .update(payload)
          .eq("workspace_id", entry.workspaceId)
          .eq("month", month)
          .eq("operation", entry.operation)
      : await admin.from("grm_ai_usage_monthly").insert(payload);
    if (error) throw new Error(error.message);
  } catch (error) {
    logger.warn("ai_usage.record_failed", { message: error instanceof Error ? error.message : "usage record failed" });
  }
}

export async function getAiBudget(
  admin: Admin,
  workspaceId: string,
  options?: { untracked?: "open" | "closed" }
): Promise<AiBudgetStatus> {
  // A super-admin per-tenant cap (grm_workspaces.ai_monthly_budget_usd) wins over the platform default.
  let budgetUsd = monthlyBudgetUsd();
  try {
    const { data: ws } = await admin.from("grm_workspaces").select("ai_monthly_budget_usd").eq("id", workspaceId).maybeSingle();
    if (ws?.ai_monthly_budget_usd != null && Number(ws.ai_monthly_budget_usd) >= 0) budgetUsd = Number(ws.ai_monthly_budget_usd);
  } catch {
    // Pre-migration database — keep the platform default.
  }
  try {
    const { data, error } = await admin
      .from("grm_ai_usage_monthly")
      .select("estimated_usd")
      .eq("workspace_id", workspaceId)
      .eq("month", monthKey());
    if (error) throw new Error(error.message);
    const spentUsd = (data ?? []).reduce((sum, row) => sum + (row.estimated_usd ?? 0), 0);
    return { spentUsd, budgetUsd, exceeded: spentUsd >= budgetUsd, tracked: true };
  } catch (error) {
    logger.warn("ai_usage.budget_unavailable", { message: error instanceof Error ? error.message : "budget unavailable" });
    // Extraction and synthesis close the gate when the ledger cannot be read.
    // Reply drafts keep the previous fail-open behaviour unless the caller asks to close.
    const closed = options?.untracked === "closed";
    return { spentUsd: 0, budgetUsd, exceeded: closed, tracked: false };
  }
}
