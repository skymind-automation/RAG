"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { toPublicError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import type { ActionResult } from "@/server/actions/run";
import { signIn, signOut } from "@/server/auth";
import { requestMetaFromHeaders } from "@/server/auth/request-meta";
import { registerUser } from "@/server/users/user-service";

const INVALID_LOGIN = "Invalid email or password.";

export async function loginAction(input: { email: string; password: string }): Promise<ActionResult<null>> {
  try {
    await signIn("credentials", { email: input.email, password: input.password, redirect: false });
    return { ok: true, data: null };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: { code: "AUTHENTICATION_REQUIRED", message: INVALID_LOGIN } };
    }
    logger.error("login crashed", { operation: "auth.login", error: err });
    return { ok: false, error: toPublicError(err) };
  }
}

export async function registerAction(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ActionResult<null>> {
  const request = requestMetaFromHeaders(await headers());
  try {
    await registerUser(input, request);
    await signIn("credentials", { email: input.email, password: input.password, redirect: false });
    return { ok: true, data: null };
  } catch (err) {
    if (!(err instanceof ValidationError)) {
      logger.warn("registration failed", { operation: "auth.register", requestId: request.requestId, error: err });
    }
    return { ok: false, error: toPublicError(err) };
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
