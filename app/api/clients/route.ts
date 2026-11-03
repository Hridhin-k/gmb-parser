import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { createAgencyClient } from "@/lib/services/agency-clients";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { bustCatalogCache } from "@/lib/services/catalog-tables";

const schema = z.object({
  action: z.literal("save"),
  name: z.string(),
  contactEmail: z.string().optional().default(""),
  website: z.string().optional().default(""),
  brandName: z.string().optional().default(""),
  logoUrl: z.string().optional().default(""),
  accountManagerUserId: z.string().uuid().nullable().optional().default(null),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, schema);
    const membership = await ensurePersonalWorkspace(user);
    const created = await createAgencyClient({
      workspaceId: membership.workspace_id,
      userId: user.id,
      client: body,
    });
    bustCatalogCache();
    return NextResponse.json({ ok: true, id: created.id });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
