import { NextResponse } from "next/server";
import { optOutPublic } from "@/lib/services/request-campaigns";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = new URL(`/r/${token}`, request.url);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.redirect(back);
  const stopped = await optOutPublic(token);
  back.searchParams.set("stopped", stopped ? "1" : "qr");
  return NextResponse.redirect(back);
}
