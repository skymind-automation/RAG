import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { attachmentDisposition, type ObjectHead, type PresignedUpload, type StorageProvider } from "./types";

/**
 * Local-disk storage for development, CI and E2E tests — NOT for production
 * (getStorage() refuses it there unless explicitly allowed). It mimics S3
 * presigning: URLs point at /api/storage/local with an HMAC-signed token that
 * pins the key, operation, content type, size and expiry. The route handler
 * enforces the token exactly as S3 would enforce a signature.
 */

export const LOCAL_STORAGE_ROUTE = "/api/storage/local";

export interface LocalToken {
  /** object key */
  k: string;
  op: "put" | "get";
  /** expiry, epoch seconds */
  exp: number;
  /** content type */
  ct: string;
  /** exact byte length (put) */
  len?: number;
  /** download file name (get) */
  fn?: string;
}

const KEY_PATTERN = /^org\/[a-z0-9]+\/tickets\/[a-z0-9]+\/[a-z0-9]+$/;

function signingKey(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for local storage signing");
  return `local-storage:v1:${secret}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function encodeLocalToken(t: LocalToken): string {
  const payload = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the token if the signature is valid and unexpired, else null. */
export function decodeLocalToken(token: string): LocalToken | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LocalToken;
    if (typeof t.exp !== "number" || t.exp < Date.now() / 1000) return null;
    if (!KEY_PATTERN.test(t.k)) return null;
    return t;
  } catch {
    return null;
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;

  constructor(
    private readonly rootDir: string,
    private readonly baseUrl: string,
  ) {}

  /** Absolute path for a key; refuses anything outside the root. */
  pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("invalid storage key");
    const full = path.resolve(this.rootDir, key);
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  private url(token: LocalToken): string {
    return `${this.baseUrl}${LOCAL_STORAGE_ROUTE}?t=${encodeURIComponent(encodeLocalToken(token))}`;
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload> {
    this.pathFor(input.key);
    const exp = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    return {
      url: this.url({ k: input.key, op: "put", exp, ct: input.contentType, len: input.sizeBytes }),
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(exp * 1000),
    };
  }

  async presignDownload(input: { key: string; fileName: string; contentType: string; expiresInSeconds: number }) {
    this.pathFor(input.key);
    const exp = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    return this.url({ k: input.key, op: "get", exp, ct: input.contentType, fn: input.fileName });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const s = await stat(this.pathFor(key));
      // Local disk has no metadata store; the PUT handler only accepts the
      // signed content type, so the signed value is authoritative.
      return { sizeBytes: s.size, contentType: null };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async ensureDirFor(key: string): Promise<string> {
    const full = this.pathFor(key);
    await mkdir(path.dirname(full), { recursive: true });
    return full;
  }
}

export { attachmentDisposition };
