import { NextResponse } from "next/server";

/** Legacy bookmarks return to the configured Auth.js login. */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
