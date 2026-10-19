import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { EscalationService } from "@/lib/services/escalations";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertScoped } from "@/lib/services/access";
import { ESCALATION_TIMEZONES } from "@/lib/escalations";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.object({
  maxStars: z.number().int().min(1).max(5),
  flagProfanity: z.boolean(),
  flagLegalSafety: z.boolean(),
  extraKeywords: z.array(z.string().trim().min(3).max(40)).max(20),
  reminderHours: z.array(z.number().int().min(1).max(72)).min(1).max(6),
  dueHours: z.number().int().min(1).max(168),
  timezone: z.enum(ESCALATION_TIMEZONES.map((item) => item.id) as [string, ...string[]]),
});

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

  const hours = [...new Set(body.reminderHours)].sort((a, b) => a - b);
  if (hours.some((hour) => hour >= body.dueHours)) {
    return NextResponse.json(
      { error: "Each reminder has to fall before the due time." },
      { status: 400 }
    );
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await assertScoped({
      userId: user.id,
      workspaceId: membership.workspace_id,
      permission: "edit_rules",
      target: { kind: "workspace" },
    });
    const timezone = ESCALATION_TIMEZONES.find((item) => item.id === body.timezone);
    if (!timezone) return NextResponse.json({ error: "Choose a supported timezone." }, { status: 400 });
    const { created } = await EscalationService.savePolicy(membership.workspace_id, user.id, {
      maxStars: body.maxStars,
      flagProfanity: body.flagProfanity,
      flagLegalSafety: body.flagLegalSafety,
      extraKeywords: [...new Set(body.extraKeywords.map((word) => word.toLowerCase()))],
      reminderHours: hours,
      dueHours: body.dueHours,
      timezone: timezone.id,
    });
    return NextResponse.json({ ok: true, created });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
