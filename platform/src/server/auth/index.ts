import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { verifyCredentials } from "./credentials";
import { requestMetaFromHeaders } from "./request-meta";

/**
 * Node-runtime Auth.js instance. Credentials (email + password) is the
 * first provider; OAuth/SAML providers slot in here later without changing
 * how authorization works, because authorization never reads the token
 * beyond `sub` and `sv`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const user = await verifyCredentials(credentials, requestMetaFromHeaders(request.headers));
        return user;
      },
    }),
  ],
});
