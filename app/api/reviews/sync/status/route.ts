import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { drainLocationPipelines, pipelineJobViews } from "@/lib/services/location-pipeline";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const parsed = z.array(z.uuid()).min(1).max(1000).safeParse(new URL(request.url).searchParams.getAll("jobId"));
  if (!parsed.success) return NextResponse.json({ error: "Valid job IDs are required." }, { status: 400 });
  const { workspace_id: workspaceId } = await ensurePersonalWorkspace(user);
  const scope = await readPageScope(user.id, workspaceId, {});
  const jobs = await pipelineJobViews(workspaceId, parsed.data, scope.locationIds);
  if (jobs.length !== new Set(parsed.data).size) return NextResponse.json({ error: "Sync job not found." }, { status: 404 });
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
  if (active.length > 0) after(async () => {
    try { await drainLocationPipelines({ workspaceId, jobIds: active.map((job) => job.id), limit: 2 }); }
    catch (error) { logger.error("pipeline.resume_failed", { workspaceId, message: String(error) }); }
  });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
