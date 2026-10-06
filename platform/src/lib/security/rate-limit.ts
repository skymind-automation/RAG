import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/observability/logger";
import { RateLimitError } from "@/lib/errors";

/**
 * Fixed-window rate limiter.
 *
 * Redis-backed when REDIS_URL is set (shared across instances), otherwise an
 * in-process map (single-instance dev only).
 *
 * Failure policy: if Redis is unreachable the limiter FAILS OPEN and logs a
 * warning. Rate limiting is abuse mitigation layered on top of real controls
 * (argon2 hashing, generic auth errors); failing closed would turn a Redis
 * outage into a total login outage. Authorization never fails open — see
 * ADR-0003.
 */

export interface RateLimitRule {
  /** Logical bucket, e.g. "login:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  const allowed = entry.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - entry.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
  };
}

export async function hitRateLimit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
  const key = `rl:${rule.name}:${subject}`;
  const redis = getRedis();
  if (!redis) return memoryHit(key, rule);
  try {
    const results = await redis.multi().incr(key).expire(key, rule.windowSeconds, "NX").ttl(key).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? rule.windowSeconds);
    const allowed = count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, ttl),
    };
  } catch (err) {
    logger.warn("rate limiter unavailable; failing open", { operation: "rate_limit", rule: rule.name, error: err });
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}

/** Throws RateLimitError when the subject is over the limit. */
export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const result = await hitRateLimit(rule, subject);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
}

export const RATE_LIMITS = {
  loginByIp: { name: "login:ip", limit: 20, windowSeconds: 15 * 60 },
  loginByEmail: { name: "login:email", limit: 8, windowSeconds: 15 * 60 },
  registerByIp: { name: "register:ip", limit: 10, windowSeconds: 60 * 60 },
  inviteByOrg: { name: "invite:org", limit: 100, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Test helper. */
export function __resetMemoryRateLimits(): void {
  memory.clear();
}
