import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { PUBLIC_PATHS, authConfig } from "@/server/auth/auth.config";

/**
 * Edge middleware: attaches a request id and redirects anonymous page
 * requests to /login. This is a UX convenience, NOT a security boundary —
 * every page, action and route handler re-establishes identity and
 * organization context on the server.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((re) => re.test(pathname));

  if (!isPublic && !req.auth?.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "AUTHENTICATION_REQUIRED", message: "Please sign in to continue." } },
        { status: 401, headers: { "x-request-id": requestId } },
      );
    }
    const url = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icon.png|favicon.ico).*)"],
};
