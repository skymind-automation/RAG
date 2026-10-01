import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for Docker and load balancers. Reports dependency state
 * only — no versions, hostnames or configuration.
 */
export async function GET() {
  const checks: Record<string, "ok" | "down" | "not_configured"> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }
  const redis = getRedis();
  if (!redis) checks.redis = "not_configured";
  else {
    try {
      checks.redis = (await redis.ping()) === "PONG" ? "ok" : "down";
    } catch {
      checks.redis = "down";
    }
  }
  const healthy = checks.database === "ok" && checks.redis !== "down";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
