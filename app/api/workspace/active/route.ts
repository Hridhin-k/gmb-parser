import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { setActiveWorkspace } from "@/lib/services/workspace";

const activeWorkspaceSchema = z.object({
  workspaceId: z.string().uuid("That workspace is invalid."),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { workspaceId: string };
  try {
    body = await parseBody(request, activeWorkspaceSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    await setActiveWorkspace(user.id, body.workspaceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not switch workspace." }, { status: 500 });
  }
}
