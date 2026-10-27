import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.url(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.url(),
  // 64 hex characters = 32 bytes = 256-bit key for AES-256-GCM token encryption
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (run: openssl rand -hex 32)"),
  CRON_SECRET: z.string().optional(),
  /** Comma-separated platform super-admin emails. Invite-only gate + /admin access. */
  SUPER_ADMIN_EMAILS: z.string().optional(),
  PLATFORM_FROM_EMAIL: z.string().optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

let _serverEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (_serverEnv) return _serverEnv;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = z.prettifyError(parsed.error);
    throw new Error(`Missing or invalid environment variables:\n${formatted}`);
  }

  _serverEnv = parsed.data;
  return _serverEnv;
}

let _clientEnv: ClientEnv | undefined;

export function getClientEnv(): ClientEnv {
  if (_clientEnv) return _clientEnv;

  const parsed = clientEnvSchema.safeParse({
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    const formatted = z.prettifyError(parsed.error);
    throw new Error(`Missing or invalid public environment variables:\n${formatted}`);
  }

  _clientEnv = parsed.data;
  return _clientEnv;
}
