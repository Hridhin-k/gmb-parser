import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getBulkJob, processBulkJob } from "@/lib/services/bulk-jobs";

const NO_STORE = { "Cache-Control": "no-store" };

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

/** GET /api/reviews/bulk/[jobId] — poll a queued bulk generate/publish job. Self-heals a stalled queue. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { jobId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const job = await getBulkJob(jobId);
  if (!job) return NextResponse.json({ error: "Bulk job not found" }, { status: 404 });
  if (job.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The background worker normally starts immediately. If the job is still
  // queued after 20s (worker died), run it from here instead.
  const staleMs = Date.now() - new Date(job.updated_at).getTime();
  if (job.status === "queued" && staleMs > 20_000) {
    after(async () => {
      await processBulkJob(jobId);
    });
  }

  const reviewIds = Array.isArray(job.review_ids) ? job.review_ids : [];
  return NextResponse.json(
    {
      status: job.status,
      total: reviewIds.length,
      succeeded: job.succeeded,
      failed: job.failed,
      results: job.status === "done" || job.status === "failed" ? (job.results ?? []) : undefined,
      error: job.last_error,
    },
    { headers: NO_STORE }
  );
}
