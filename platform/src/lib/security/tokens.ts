import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token (invitations, future API keys). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored only as SHA-256 digests; the raw value lives in the link. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
