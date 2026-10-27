import { cache } from "react";
import { auth } from "@/auth";
import { findAuthUser } from "./users";
import type { User } from "./types";

/** Validate the session with Auth.js; roles/membership remain database-backed. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  return session?.user?.id ? findAuthUser(session.user.id) : null;
});
