import { NextResponse } from "next/server";

/** Resend webhooks are retired. Email delivery uses Brevo — see `/api/requests/hooks/brevo`. */
export async function POST() {
  return NextResponse.json(
    { error: "Email delivery uses Brevo. Point webhooks to /api/requests/hooks/brevo." },
    { status: 410 }
  );
}
