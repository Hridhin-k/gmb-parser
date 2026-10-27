import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  enterBenchDiagFromHeaders,
  isBenchDiagEnabled,
  peekBenchDiag,
  takeBenchDiag,
} from "@/lib/bench-diag";
import { getCurrentUser } from "@/lib/services/session";
import { STAGING_SUPABASE_REF, getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * Staging-only diagnostic read-back for authenticated HTTP benchmarks.
 * Requires REVUPILOT_APP_DIAG=1, a signed-in user, and the staging project.
 * Never returns cookies, tokens, or review content.
 */
export async function GET(request: Request) {
  const gate = isBenchDiagEnabled();
  if (!gate.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { projectRef } = getSupabasePublicConfig();
    if (projectRef !== STAGING_SUPABASE_REF) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("probe") === "1") {
    const headerStore = await headers();
    const headerId = headerStore.get("x-revupilot-bench-id");
    await enterBenchDiagFromHeaders(headerId);
    return NextResponse.json({
      enabled: true,
      headerPresent: Boolean(headerId),
      headerLen: headerId?.length ?? 0,
      peekExists: headerId ? Boolean(peekBenchDiag(headerId)) : false,
    });
  }

  const id = url.searchParams.get("id") ?? "";
  const snapshot = takeBenchDiag(id);
  if (!snapshot) {
    return NextResponse.json({ error: "No diagnostics for id" }, { status: 404 });
  }

  return NextResponse.json({
    id: snapshot.id,
    cache: snapshot.cache,
    rpcCount: snapshot.rpcs.length,
    rpcs: snapshot.rpcs,
    elapsedMs: Date.now() - snapshot.startedAt,
  });
}
