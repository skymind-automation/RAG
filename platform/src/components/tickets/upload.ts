"use client";

import { confirmUploadAction, requestUploadAction } from "@/app/actions/tickets";
import { inferContentType } from "@/lib/attachments";

/**
 * Three-step direct upload: ask the server for a presigned URL (it validates
 * and authorizes), PUT the bytes straight to storage, then ask the server to
 * confirm (it verifies what actually arrived). Returns the attachment id.
 */
export async function uploadAttachment(
  orgSlug: string,
  ticketId: string,
  file: File,
  visibility: "PUBLIC" | "INTERNAL" = "PUBLIC",
): Promise<string> {
  const contentType = inferContentType(file.name, file.type);
  const req = await requestUploadAction(orgSlug, {
    ticketId,
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    visibility,
  });
  if (!req.ok) {
    const fieldMsg = req.error.fieldErrors ? Object.values(req.error.fieldErrors)[0]?.[0] : undefined;
    throw new Error(fieldMsg ?? req.error.message);
  }
  const { attachmentId, upload } = req.data;
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!put.ok) throw new Error("The upload was interrupted. Please try again.");
  const confirmed = await confirmUploadAction(orgSlug, { attachmentId });
  if (!confirmed.ok) throw new Error(confirmed.error.message);
  return attachmentId;
}
