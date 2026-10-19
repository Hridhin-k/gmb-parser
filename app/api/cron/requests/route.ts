import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runRequestJobs } from "@/lib/services/request-campaigns";

/** Retries failed request sends and sends one reminder when a campaign asked for it. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRequestJobs();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("cron.requests.failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Request run failed" }, { status: 500 });
  }
}
