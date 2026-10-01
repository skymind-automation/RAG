import "server-only";
import { NextResponse } from "next/server";
import type { OrgContext } from "@/server/context";
import { runInOrg } from "./run";

/**
 * Route-handler adapter over runInOrg: same context resolution, same error
 * mapping, JSON out. `params.orgSlug` only selects the organization.
 */
export function orgRoute<T>(operation: string, handler: (ctx: OrgContext, request: Request) => Promise<T>) {
  return async (request: Request, { params }: { params: Promise<{ orgSlug: string }> }) => {
    const { orgSlug } = await params;
    const result = await runInOrg(orgSlug, operation, (ctx) => handler(ctx, request));
    if (result.ok) return NextResponse.json({ data: result.data });
    const status = statusFor(result.error.code);
    const res = NextResponse.json({ error: result.error }, { status });
    if (result.error.retryAfterSeconds) res.headers.set("Retry-After", String(result.error.retryAfterSeconds));
    return res;
  };
}

const STATUS: Record<string, number> = {
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  TENANT_ACCESS_DENIED: 404,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EXTERNAL_PROVIDER_ERROR: 502,
  AI_PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

function statusFor(code: string): number {
  return STATUS[code] ?? 500;
}
