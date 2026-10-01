import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { attachmentDisposition, decodeLocalToken, LocalStorageProvider } from "@/lib/storage/local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Local-disk stand-in for S3 presigned URLs (development / tests only).
 * The signed token is the sole credential, exactly like an S3 signature: it
 * pins one key, one operation, the content type, the exact size, and an
 * expiry. No session is consulted, because authorization already happened
 * when the URL was issued.
 */

function local(): LocalStorageProvider | null {
  const storage = getStorage();
  return storage instanceof LocalStorageProvider ? storage : null;
}

function deny(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function PUT(request: Request) {
  const storage = local();
  if (!storage) return deny(404, "Not found");
  const token = decodeLocalToken(new URL(request.url).searchParams.get("t") ?? "");
  if (!token || token.op !== "put" || typeof token.len !== "number") return deny(403, "Invalid or expired upload URL");
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== token.ct) return deny(403, "Content-Type does not match the signed upload");
  const declared = Number(request.headers.get("content-length") ?? token.len);
  if (declared !== token.len) return deny(403, "Content-Length does not match the signed upload");

  // Read with a hard cap: never buffer more than the signed size.
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body?.getReader();
  if (!reader) return deny(400, "Empty body");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > token.len) {
      await reader.cancel();
      return deny(413, "Body exceeds the signed size");
    }
    chunks.push(value);
  }
  if (received !== token.len) return deny(400, "Body size does not match the signed size");
  const path = await storage.ensureDirFor(token.k);
  await writeFile(path, Buffer.concat(chunks), { flag: "w" });
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  const storage = local();
  if (!storage) return deny(404, "Not found");
  const token = decodeLocalToken(new URL(request.url).searchParams.get("t") ?? "");
  if (!token || token.op !== "get") return deny(403, "Invalid or expired download URL");
  const path = storage.pathFor(token.k);
  const info = await stat(path).catch(() => null);
  if (!info) return deny(404, "Not found");
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new NextResponse(body, {
    headers: {
      "Content-Type": token.ct,
      "Content-Length": String(info.size),
      "Content-Disposition": attachmentDisposition(token.fn ?? "file"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
