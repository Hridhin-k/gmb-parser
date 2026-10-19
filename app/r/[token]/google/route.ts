import { NextResponse } from "next/server";
import { publicGoogleUrl } from "@/lib/services/request-campaigns";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await publicGoogleUrl(token);
  if (!url) return NextResponse.redirect(new URL(`/r/${token}`, _request.url));
  return NextResponse.redirect(url);
}
