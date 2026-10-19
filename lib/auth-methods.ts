import { authMethods, type AuthMethod } from "@/lib/onboarding";

/** Server-only. Reads provider flags and never treats a missing provider as ready. */
export function authMethodsFromEnv(): AuthMethod[] {
  return authMethods({
    microsoft: Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET),
    email: process.env.AUTH_EMAIL_ENABLED === "true",
    ssoDomain: process.env.AUTH_SSO_DOMAIN,
    phone: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_VERIFY_SERVICE_SID
    ),
  });
}
