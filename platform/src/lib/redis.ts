import Redis from "ioredis";

/**
 * Shared Redis connection (rate limiting now; BullMQ queues and SSE fan-out
 * in later phases). Returns null when REDIS_URL is unset so local tooling and
 * unit tests work without Redis; callers decide how to degrade.
 */

const globalForRedis = globalThis as unknown as { __redis?: Redis | null };

export function getRedis(): Redis | null {
  if (globalForRedis.__redis !== undefined) return globalForRedis.__redis;
  const url = process.env.REDIS_URL;
  const client = url
    ? new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false })
    : null;
  // Connection errors are surfaced per-command; don't crash on 'error' events.
  client?.on("error", () => undefined);
  globalForRedis.__redis = client;
  return client;
}
