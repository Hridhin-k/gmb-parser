import { authMethods, type AuthMethod } from "@/lib/onboarding";

/** Only show providers registered by auth.ts. */
export function authMethodsFromEnv(): AuthMethod[] {
  return process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? authMethods() : [];
}
