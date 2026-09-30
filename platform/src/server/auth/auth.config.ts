import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration (used by middleware). No database, no
 * argon2 — those live in ./index.ts, which runs on the Node runtime.
 *
 * The JWT carries only two claims we rely on:
 *   sub — the user id
 *   sv  — the user's sessionVersion when the token was issued
 * Everything mutable (active organization, role, permissions, whether the
 * account is still active) is read from the database on each request by
 * requireAuth()/requireOrganization(). See ADR-0003.
 */

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const PUBLIC_PATHS = [/^\/login$/, /^\/register$/, /^\/invite\/[^/]+$/, /^\/api\/auth\//, /^\/api\/health$/];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 24 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    /**
     * Middleware gate — a UX redirect only. It proves a token exists, not that
     * the user may see anything; every page and action re-checks on the
     * server.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.some((re) => re.test(pathname))) return true;
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.sessionVersion = typeof token.sv === "number" ? token.sv : 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
