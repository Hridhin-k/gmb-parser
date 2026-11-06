import { NextResponse } from "next/server";
import { drainLocationPipelines } from "@/lib/services/location-pipeline";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";

export const maxDuration = 300;

/** Independent of browser polling; resumes leases lost to a server restart. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const processed = await drainLocationPipelines({ limit: 2 });
  // Replies Google read but would not take get their later tries here.
  const replyRetries = await ReplyPublishingService.retryWriteRejectedReplies({ limit: 10 }).catch((error: unknown) => ({
    tried: 0, published: 0, error: error instanceof Error ? error.message : "Unknown",
  }));
  return NextResponse.json({ processed, replyRetries });
}
