/**
 * Object storage abstraction. The application never streams large files
 * itself: it authorizes, then hands the browser a short-lived presigned URL
 * scoped to exactly one object, method, content type and size.
 */

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Headers the client must send verbatim (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageProvider {
  readonly name: "s3" | "local";
  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;
  presignDownload(input: {
    key: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
}

/** RFC 6266 Content-Disposition that is safe for any file name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
