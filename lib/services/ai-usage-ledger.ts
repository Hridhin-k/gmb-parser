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
    usageKnown?: boolean;
    status?: string;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  }
): Promise<void> {
  try {
    const month = monthKey();
    // Conservative cache-write allowance; reasoning is already in outputTokens.
    const inputForEstimate = entry.inputTokens + 1.5 * (entry.cacheWriteTokens ?? 0);
    let cost = estimateCostUsd(entry.model, inputForEstimate, entry.outputTokens, entry.batch);
    if (entry.model === "openai:gpt-6-luna" && entry.inputTokens > 272_000) {
      cost = estimateCostUsd(entry.model, inputForEstimate * 2, entry.outputTokens * 1.5, entry.batch);
    }
    const { error } = await admin.rpc("grm_record_ai_usage", {
      p_event_id: crypto.randomUUID(),
      p_workspace_id: entry.workspaceId,
      p_month: month,
      p_operation: entry.operation,
      p_model: entry.model,
      p_input_tokens: entry.inputTokens,
      p_output_tokens: entry.outputTokens,
      p_estimated_usd: cost,
      p_usage_known: entry.usageKnown ?? true,
      p_status: entry.status ?? "completed",
      p_calls: entry.calls ?? 1,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    logger.warn("ai_usage.record_failed", { message: error instanceof Error ? error.message : "usage record failed" });
  }
}

export async function getAiBudget(admin: Admin, workspaceId: string): Promise<AiBudgetStatus> {
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
    return { spentUsd: 0, budgetUsd, exceeded: false, tracked: false };
  }
}
