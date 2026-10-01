import { randomUUID } from "node:crypto";
import type { RequestMeta } from "@/server/context";

export const REQUEST_ID_HEADER = "x-request-id";

interface HeaderLike {
  get(name: string): string | null;
}

/**
 * Client IP: the first `x-forwarded-for` hop. That header is only
 * trustworthy behind a proxy that overwrites it (Vercel, a configured load
 * balancer). Set TRUST_PROXY=0 when running without one and the IP is then
 * recorded as unknown rather than attacker-controlled.
 */
function clientIp(headers: HeaderLike): string | null {
  if (process.env.TRUST_PROXY === "0") return null;
  const fwd = headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  const ip = first || headers.get("x-real-ip")?.trim() || null;
  return ip && ip.length <= 64 ? ip : null;
}

export function requestMetaFromHeaders(headers: HeaderLike): RequestMeta {
  const incoming = headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  return {
    requestId,
    ipAddress: clientIp(headers),
    userAgent: headers.get("user-agent"),
  };
}
