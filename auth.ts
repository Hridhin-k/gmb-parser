import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { timingSafeEqual } from "node:crypto";
import { getAuthPool } from "@/lib/db/pool";
import { devLoginEnabled } from "@/lib/auth/dev-login";

const localLogin = devLoginEnabled();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(getAuthPool()),
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  // Credentials are restricted to the local development helper. Production
  // OAuth sessions are opaque tokens persisted/revoked in Postgres.
  session: { strategy: localLogin ? "jwt" : "database", maxAge: 7 * 24 * 60 * 60 },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })] : []),
    ...(localLogin ? [Credentials({
      id: "local", name: "Local development", credentials: { token: { type: "password" } },
      async authorize(credentials, request) {
        if (!devLoginEnabled() || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) return null;
        const supplied = Buffer.from(typeof credentials.token === "string" ? credentials.token : "");
        const expected = Buffer.from(process.env.AUTH_DEV_LOGIN_TOKEN || "");
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
        const { rows } = await getAuthPool().query("SELECT id,email,name,image FROM authn.users WHERE email=$1", [process.env.AUTH_DEV_EMAIL || "local@grm.test"]);
        return rows[0] || null;
      },
    })] : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // Tenant invites use email identity; unverified OAuth email cannot claim one.
      return account?.provider !== "google" || profile?.email_verified === true;
    },
    async session({ session, user, token }) {
      if (session.user) session.user.id = user?.id || token?.sub || "";
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) await getAuthPool().query("UPDATE authn.users SET last_sign_in_at=now() WHERE id=$1", [user.id]);
    },
  },
});
