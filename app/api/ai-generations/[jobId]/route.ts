import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/db/client";
import { getAiGenerationJob } from "@/lib/services/ai-generation-jobs";
import { persistAiGenerationJob } from "@/lib/services/ai-generation-persist";

const NO_STORE = { "Cache-Control": "no-store" };

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

async function loadOwnedJob(jobId: string, userId: string) {
  const job = await getAiGenerationJob(jobId);
  if (!job) return { error: NextResponse.json({ error: "Generation not found" }, { status: 404 }) };
  if (job.user_id !== userId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { job };
}

/** GET /api/ai-generations/[jobId] — poll background save status. Self-heals stale jobs. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { jobId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { job, error } = await loadOwnedJob(jobId, user.id);
  if (error) return error;

  // The background persister normally finishes in about a second. If the job
  // is still waiting after 20s, run the persister from here instead.
  const staleMs = Date.now() - new Date(job!.updated_at).getTime();
  if (job!.status === "generated" && staleMs > 20_000) {
    after(async () => {
      await persistAiGenerationJob(jobId);
    });
  }

  return NextResponse.json({
    status: job!.status,
    draftId: job!.draft_id,
    replyId: job!.reply_id,
    error: job!.last_error,
  }, { headers: NO_STORE });
}

/** POST /api/ai-generations/[jobId] — retry a failed background save. No model call. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { jobId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { job, error } = await loadOwnedJob(jobId, user.id);
  if (error) return error;

  if (job!.status === "failed" || job!.status === "generated") {
    if (job!.status === "failed") {
      const admin = createAdminClient();
      await admin
        .from("grm_ai_generation_jobs")
        .update({ status: "generated", attempts: 0, last_error: null })
        .eq("id", jobId)
        .eq("status", "failed");
    }
    after(async () => {
      await persistAiGenerationJob(jobId);
    });
    return NextResponse.json({ status: "generated" });
  }

  return NextResponse.json({ status: job!.status });
}
