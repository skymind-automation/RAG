import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentDisposition, type ObjectHead, type PresignedUpload, type StorageProvider } from "./types";

/**
 * AWS S3 / Cloudflare R2 / any S3-compatible store. Credentials stay on the
 * server; the browser only ever sees a presigned URL.
 *
 * Uploads sign Content-Type and Content-Length, so the client cannot swap in
 * a different type or a larger file than was authorized. Downloads force
 * `Content-Disposition: attachment` so stored files never render inline on
 * the storage origin.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: Boolean(config.endpoint),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  presignDownload(input: { key: string; fileName: string; contentType: string; expiresInSeconds: number }) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ResponseContentDisposition: attachmentDisposition(input.fileName),
      ResponseContentType: input.contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
