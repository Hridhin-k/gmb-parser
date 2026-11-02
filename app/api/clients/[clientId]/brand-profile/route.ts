import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { checkRateLimit, SYNC_ALL_LIMIT } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { draftBrandProfile, saveBrandProfile } from "@/lib/services/brand-profile";

export const maxDuration = 90;

const profileSchema = z.object({
  summary: z.string().max(2000),
  offerings: z.array(z.string().max(300)).max(40),
  customerVocabulary: z.array(z.string().max(300)).max(40),
  staffRoles: z.array(z.string().max(300)).max(40),
  themeHints: z.array(z.string().max(300)).max(40),
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft") }),
  z.object({
    action: z.literal("save"),
    profile: profileSchema.nullable(),
    source: z.enum(["website", "manual"]),
  }),
]);

/**
 * POST /api/clients/:id/brand-profile
 *   { action: "draft" }                      read the saved website, return a draft profile (nothing saved)
 *   { action: "save", profile, source }      save an edited profile, or null to clear it
 */
export async function POST(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { clientId } = await context.params;
  try {
    const body = await parseBody(request, schema);
    const { workspace_id: workspaceId } = await ensurePersonalWorkspace(user);
    if (body.action === "draft") {
      const rl = checkRateLimit(user.id, "brand.draft", SYNC_ALL_LIMIT);
      if (!rl.allowed) {
        return NextResponse.json({ error: "Too many requests. Wait a few minutes before building another profile." }, { status: 429 });
      }
      const result = await draftBrandProfile({ workspaceId, userId: user.id, clientId });
      return NextResponse.json({ ok: true, ...result });
    }
    const profile = await saveBrandProfile({
      workspaceId,
      userId: user.id,
      clientId,
      profile: body.profile,
      source: body.source,
    });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
