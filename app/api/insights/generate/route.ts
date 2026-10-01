import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationInsightService } from "@/lib/services/location-insights";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/validation";
import { checkRateLimit, AI_GENERATE_LIMIT } from "@/lib/rate-limit";

const bodySchema = z.object({
  locationId: z.string().uuid(),
  force: z.boolean().optional(),
});

/**
 * POST /api/insights/generate
 * Body: { locationId, force? }
 * Generates or returns cached AI reputation summary for a location.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = checkRateLimit(user.id, "insights.generate", {
    ...AI_GENERATE_LIMIT,
    limit: 8,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Insight generation rate limit reached. Wait a minute to conserve AI quota.",
      },
      { status: 429 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: location } = await admin
    .from("grm_google_locations")
    .select("id, workspace_id")
    .eq("id", body.locationId)
    .single();

  if (!location) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", location.workspace_id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const insight = await LocationInsightService.generateForLocation(
      location.workspace_id,
      body.locationId,
      user.id,
      { force: body.force === true }
    );
    return NextResponse.json({ success: true, insight });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode >= 400 ? error.statusCode : 500 }
      );
    }
    logger.error("insights.generate.failed", {
      userId: user.id,
      locationId: body.locationId,
    });
    return NextResponse.json(
      { error: "Failed to generate location insight" },
      { status: 500 }
    );
  }
}
