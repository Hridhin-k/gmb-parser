import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/types/supabase";

export type AiGenerationKind = "reply";
export type AiGenerationStatus = "generated" | "persisting" | "saved" | "failed" | "superseded";

export interface AiGenerationJob {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: AiGenerationKind;
  review_id: string | null;
  location_id: string | null;
  scope_kind: "client" | "group" | null;
  scope_id: string | null;
  model: string;
  route: string | null;
  content: string | null;
  payload: Record<string, unknown>;
  status: AiGenerationStatus;
  attempts: number;
  last_error: string | null;
  draft_id: string | null;
  reply_id: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_ATTEMPTS = 5;

/**
 * One fast durable write for freshly generated content. Returns null when the
 * jobs table is unavailable so callers can fall back to saving synchronously.
 */
export async function createAiGenerationJob(input: {
  workspaceId: string;
  userId: string;
  kind: AiGenerationKind;
  reviewId?: string | null;
  locationId?: string | null;
  scopeKind?: "client" | "group" | null;
  scopeId?: string | null;
  model: string;
  route?: string | null;
  content?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  const admin = createAdminClient();
  if (input.kind === "reply" && input.reviewId) {
    // A newer generation wins. Older unsaved jobs for this review stand down.
    await admin
      .from("grm_ai_generation_jobs")
      .update({ status: "superseded" })
      .eq("kind", "reply")
      .eq("review_id", input.reviewId)
      .eq("status", "generated");
  }
  const { data, error } = await admin
    .from("grm_ai_generation_jobs")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: input.kind,
      review_id: input.reviewId ?? null,
      location_id: input.locationId ?? null,
      scope_kind: input.scopeKind ?? null,
      scope_id: input.scopeId ?? null,
      model: input.model,
      route: input.route ?? null,
      content: input.content ?? null,
      payload: (input.payload ?? {}) as unknown as Json,
      status: "generated",
    })
    .select("id")
    .single();
  if (error || !data) {
    logger.error("ai_job.create_failed", { message: error?.message ?? "Unknown" });
    return null;
  }
  return data.id as string;
}

export async function getAiGenerationJob(jobId: string): Promise<AiGenerationJob | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_ai_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  return (data as AiGenerationJob | null) ?? null;
}

/** Atomically claim a job for persistence. Only one persister wins. */
export async function claimAiGenerationJob(jobId: string): Promise<AiGenerationJob | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_ai_generation_jobs")
    .update({ status: "persisting" })
    .eq("id", jobId)
    .eq("status", "generated")
    .select("*")
    .maybeSingle();
  return (data as AiGenerationJob | null) ?? null;
}

export async function completeAiGenerationJob(
  jobId: string,
  result: { draftId?: string | null; replyId?: string | null }
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("grm_ai_generation_jobs")
    .update({
      status: "saved",
      draft_id: result.draftId ?? null,
      reply_id: result.replyId ?? null,
      last_error: null,
    })
    .eq("id", jobId);
}

export async function failAiGenerationJob(jobId: string, attempts: number, error: unknown): Promise<void> {
  const admin = createAdminClient();
  const message = error instanceof Error ? error.message : "Unknown persistence error";
  await admin
    .from("grm_ai_generation_jobs")
    .update({
      status: attempts >= MAX_ATTEMPTS ? "failed" : "generated",
      attempts,
      last_error: message.slice(0, 500),
    })
    .eq("id", jobId);
  logger.error("ai_job.persist_failed", { jobId, attempts, message });
}

/** Jobs whose background persister never finished. Used by the reconciler. */
export async function listStaleAiGenerationJobs(limit = 10): Promise<AiGenerationJob[]> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data } = await admin
    .from("grm_ai_generation_jobs")
    .select("*")
    .in("status", ["generated", "persisting"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(limit);
  const jobs = (data as AiGenerationJob[] | null) ?? [];
  // A persister that died mid-flight leaves the job in "persisting"; free it.
  for (const job of jobs) {
    if (job.status === "persisting") {
      await admin
        .from("grm_ai_generation_jobs")
        .update({ status: "generated" })
        .eq("id", job.id)
        .eq("status", "persisting");
      job.status = "generated";
    }
  }
  return jobs;
}
