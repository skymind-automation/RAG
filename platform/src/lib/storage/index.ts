import path from "node:path";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

/**
 * Storage driver selection (fail closed):
 *   STORAGE_DRIVER=s3     → S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_ENDPOINT for R2/MinIO)
 *   STORAGE_DRIVER=local  → LOCAL_STORAGE_DIR (default .data/storage); refused in production
 *                           unless STORAGE_ALLOW_LOCAL=1
 * Unset: s3 when S3_BUCKET is set, else local outside production, else error.
 */

let cached: StorageProvider | null = null;

export class StorageNotConfiguredError extends Error {}

function appBaseUrl(): string {
  return (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function getStorage(): StorageProvider {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? "s3" : "local");
  if (driver === "s3") {
    const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT } = process.env;
    if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new StorageNotConfiguredError("S3 storage selected but S3_BUCKET / credentials are missing");
    }
    cached = new S3StorageProvider(S3_BUCKET, {
      endpoint: S3_ENDPOINT,
      region: S3_REGION || "auto",
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    });
    return cached;
  }
  if (driver === "local") {
    if (process.env.NODE_ENV === "production" && process.env.STORAGE_ALLOW_LOCAL !== "1") {
      throw new StorageNotConfiguredError("Local storage is disabled in production; configure S3/R2");
    }
    cached = new LocalStorageProvider(path.resolve(process.env.LOCAL_STORAGE_DIR || ".data/storage"), appBaseUrl());
    return cached;
  }
  throw new StorageNotConfiguredError(`Unknown STORAGE_DRIVER: ${driver}`);
}

/** Tests: swap in a fake provider. */
export function __setStorageForTests(provider: StorageProvider | null): void {
  cached = provider;
}

export type { StorageProvider } from "./types";
