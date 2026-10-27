import { getAuthUserById } from "@/lib/auth/users";

export interface AuthProfile {
  email: string;
  lastActive: string | null;
  twoStep: "on" | "off" | "unavailable";
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { profile: AuthProfile; at: number }>();

/**
 * Auth profiles come from the private Postgres auth schema. Results are reused
 * for a few minutes and uncached lookups are bounded. Provider MFA state is
 * unavailable here; it must not be presented as disabled.
 */
export async function loadAuthProfiles(userIds: string[]): Promise<Map<string, AuthProfile>> {
  const now = Date.now();
  const unique = [...new Set(userIds)];
  const profiles = new Map<string, AuthProfile>();
  const missing: string[] = [];

  for (const id of unique) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) profiles.set(id, hit.profile);
    else missing.push(id);
  }

  const concurrency = 4;
  for (let index = 0; index < missing.length; index += concurrency) {
    const slice = missing.slice(index, index + concurrency);
    const loaded = await Promise.all(
      slice.map(async (userId) => {
        const { data } = await getAuthUserById(userId);
        const authUser = data.user as
          | { email?: string | null; last_sign_in_at?: string | null; factors?: Array<{ status?: string }> }
          | undefined;
        const factors = authUser?.factors;
        const profile: AuthProfile = {
          email: authUser?.email ?? "Unknown email",
          lastActive: authUser?.last_sign_in_at ?? null,
          twoStep:
            factors === undefined
              ? "unavailable"
              : factors.some((factor) => factor.status === "verified")
                ? "on"
                : "off",
        };
        cache.set(userId, { profile, at: Date.now() });
        return [userId, profile] as const;
      })
    );
    for (const [userId, profile] of loaded) profiles.set(userId, profile);
  }

  return profiles;
}
