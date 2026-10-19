import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { EscalationService } from "@/lib/services/escalations";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertReviewAction } from "@/lib/services/access";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.object({
  reviewId: z.string().uuid(),
});

/** Opens an escalation for a review. An open escalation for that review is reused. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = await parseBody(request, schema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await assertReviewAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId: body.reviewId,
      action: "draft",
    });
    const opened = await EscalationService.openManual({
      workspaceId: membership.workspace_id,
      reviewId: body.reviewId,
      actorId: user.id,
    });
    return NextResponse.json(opened);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
