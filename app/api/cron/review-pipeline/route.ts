import { NextResponse } from "next/server";
import { drainLocationPipelines } from "@/lib/services/location-pipeline";

export const maxDuration = 300;

/** Independent of browser polling; resumes leases lost to a server restart. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const processed = await drainLocationPipelines({ limit: 2 });
  return NextResponse.json({ processed });
}
