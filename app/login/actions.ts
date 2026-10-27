"use server";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { devLoginEnabled } from "@/lib/auth/dev-login";

export async function localSignIn() {
  const host = (await headers()).get("host")?.split(":")[0];
  if (!devLoginEnabled() || !["localhost", "127.0.0.1"].includes(host || "")) throw new Error("Local sign-in unavailable");
  await signIn("local", { token: process.env.AUTH_DEV_LOGIN_TOKEN, redirectTo: "/login" });
}
