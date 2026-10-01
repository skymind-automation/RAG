import { randomBytes } from "node:crypto";
import { scopedDb } from "@/lib/db/tenant";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import { getScanner } from "@/lib/storage/scanner";
import { getStorage } from "@/lib/storage";
import { parseInput } from "@/lib/validation/parse";
import { attachmentIdSchema, requestUploadSchema } from "@/lib/validation/schemas";
import { ALLOWED_TYPES, extensionOf } from "@/lib/attachments";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { canSeeInternal, readScope } from "@/server/tickets/ticket-access";

/**
 * AttachmentService.
 *
 *   1. requestUpload  → validate type/size/extension + authorization, create a
 *                       PENDING_UPLOAD row, return a presigned PUT (5 minutes)
 *   2. browser PUTs the bytes straight to storage (never through the app)
 *   3. confirmUpload  → HEAD the object: size and type must match what was
 *                       authorized; run the malware-scan hook; AVAILABLE
 *   4. getDownloadUrl → authorize, presigned GET (60 s), audited
 *
 * Storage keys are `org/<organizationId>/tickets/<ticketId>/<random>`: the
 * file name never enters the key, and a CHECK constraint ties the key prefix
 * to the row's organization.
 */

export const MAX_ATTACHMENT_BYTES = Number(process.env.ATTACHMENT_MAX_BYTES ?? 25 * 1024 * 1024);
const MAX_ATTACHMENTS_PER_TICKET = 100;
const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Strip paths, control characters and reserved characters; keep it readable. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

/** Validate name/type/size; returns the normalised name and type. */
export function validateUpload(fileName: string, contentType: string, sizeBytes: number) {
  const name = sanitizeFileName(fileName);
  const ext = extensionOf(name);
  const type = contentType.toLowerCase().split(";")[0]!.trim();
  const allowed = ALLOWED_TYPES[ext];
  const errors: Record<string, string[]> = {};
  if (!allowed) errors.fileName = ["This file type isn't allowed."];
  else if (!allowed.includes(type)) errors.contentType = ["The file's type doesn't match its extension."];
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    errors.sizeBytes = [`Files can be at most ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`];
  }
  if (Object.keys(errors).length) throw new ValidationError("This file can't be uploaded.", errors);
  return { fileName: name, contentType: type };
}

/** Who may add files: staff on any ticket; requesters on their own tickets. */
function assertCanUpload(ctx: OrgContext): void {
  requirePermission(ctx, "tickets.comment");
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
}

export async function requestUpload(ctx: OrgContext, raw: unknown) {
  assertCanUpload(ctx);
  const input = parseInput(requestUploadSchema, raw);
  const file = validateUpload(input.fileName, input.contentType, input.sizeBytes);
  if (input.visibility === "INTERNAL") requirePermission(ctx, "tickets.comment_internal");
  const organizationId = ctx.organization.id;
  const db = scopedDb(organizationId);

  const created = await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { AND: [readScope(ctx), { id: input.ticketId }] },
      select: { id: true, key: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");
    const existing = await tx.attachment.count({ where: { ticketId: ticket.id, deletedAt: null } });
    if (existing >= MAX_ATTACHMENTS_PER_TICKET) {
      throw new ValidationError(`A ticket can have at most ${MAX_ATTACHMENTS_PER_TICKET} files.`);
    }
    const id = randomBytes(12).toString("hex");
    const storageKey = `org/${organizationId}/tickets/${ticket.id}/${id}`;
    const attachment = await tx.attachment.create({
      data: {
        id,
        organizationId,
        ticketId: ticket.id,
        storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: input.sizeBytes,
        visibility: input.visibility,
        uploadedById: ctx.user.id,
      },
      select: { id: true, storageKey: true, contentType: true, sizeBytes: true },
    });
    await recordAudit(tx, ctx, {
      action: "attachment.upload_requested",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key: ticket.key, attachmentId: id, contentType: file.contentType, sizeBytes: input.sizeBytes },
    });
    return attachment;
  });

  const upload = await getStorage().presignUpload({
    key: created.storageKey,
    contentType: created.contentType,
    sizeBytes: created.sizeBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return { attachmentId: created.id, upload };
}

/**
 * Verify the object that actually landed in storage matches what was
 * authorized, then hand it to the malware scanner.
 */
export async function confirmUpload(ctx: OrgContext, raw: unknown) {
  assertCanUpload(ctx);
  const { attachmentId } = parseInput(attachmentIdSchema, raw);
  const db = scopedDb(ctx.organization.id);
  const att = await db.attachment.findFirst({
    where: { id: attachmentId, uploadedById: ctx.user.id, status: "PENDING_UPLOAD", deletedAt: null },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      ticket: { select: { id: true, key: true } },
    },
  });
  if (!att) throw new NotFoundError("Upload not found.");

  const storage = getStorage();
  const head = await storage.head(att.storageKey);
  const mismatch =
    !head ||
    head.sizeBytes !== att.sizeBytes ||
    (head.contentType !== null && head.contentType.split(";")[0]!.trim().toLowerCase() !== att.contentType);
  if (mismatch) {
    if (head) await storage.delete(att.storageKey).catch(() => undefined);
    await db.attachment.updateMany({ where: { id: att.id }, data: { status: "DELETED", deletedAt: new Date() } });
    throw new ValidationError("The uploaded file didn't match what was expected. Please try again.");
  }

  const scanner = getScanner();
  const verdict = await scanner.scan({
    storageKey: att.storageKey,
    contentType: att.contentType,
    sizeBytes: att.sizeBytes,
  });
  if (verdict === "SKIPPED") {
    logger.debug("attachment not scanned (no scanner configured)", {
      organizationId: ctx.organization.id,
      operation: "attachment.confirm",
      attachmentId: att.id,
    });
  }
  const status = verdict === "INFECTED" ? "QUARANTINED" : verdict === "PENDING" ? "PENDING_SCAN" : "AVAILABLE";
  const scanStatus =
    verdict === "INFECTED"
      ? "INFECTED"
      : verdict === "CLEAN"
        ? "CLEAN"
        : verdict === "SKIPPED"
          ? "SKIPPED"
          : "NOT_SCANNED";

  await db.$transaction(async (tx) => {
    const { count } = await tx.attachment.updateMany({
      where: { id: att.id, status: "PENDING_UPLOAD" },
      data: { status, scanStatus },
    });
    if (count === 0) throw new NotFoundError("Upload not found.");
    await recordAudit(tx, ctx, {
      action: verdict === "INFECTED" ? "attachment.quarantined" : "attachment.uploaded",
      entityType: "ticket",
      entityId: att.ticket.id,
      metadata: {
        key: att.ticket.key,
        attachmentId: att.id,
        fileName: att.fileName,
        sizeBytes: att.sizeBytes,
        scanner: scanner.name,
        verdict,
      },
    });
  });
  if (verdict === "INFECTED") {
    throw new ValidationError("This file was blocked by the malware scanner.");
  }
  return { attachmentId: att.id, status };
}

/** Files on a ticket the caller may see. Requesters never see internal files. */
export async function listTicketAttachments(ctx: OrgContext, ticketId: string) {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({
    where: { AND: [readScope(ctx), { id: ticketId }] },
    select: { id: true },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  const internal = canSeeInternal(ctx);
  return db.attachment.findMany({
    where: {
      ticketId: ticket.id,
      deletedAt: null,
      status: { in: internal ? ["AVAILABLE", "PENDING_SCAN", "QUARANTINED"] : ["AVAILABLE"] },
      ...(internal ? {} : { visibility: "PUBLIC" as const }),
    },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      status: true,
      visibility: true,
      commentId: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Short-lived download URL. Authorization is re-derived from the ticket and
 * the attachment's visibility on every call; quarantined, pending and deleted
 * files are never downloadable.
 */
export async function getDownloadUrl(ctx: OrgContext, raw: unknown): Promise<string> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const { attachmentId } = parseInput(attachmentIdSchema, raw);
  const db = scopedDb(ctx.organization.id);
  const att = await db.attachment.findFirst({
    where: {
      id: attachmentId,
      status: "AVAILABLE",
      deletedAt: null,
      ticket: readScope(ctx),
      ...(canSeeInternal(ctx) ? {} : { visibility: "PUBLIC" as const }),
    },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      contentType: true,
      ticket: { select: { id: true, key: true } },
    },
  });
  if (!att) throw new NotFoundError("File not found.");
  const url = await getStorage().presignDownload({
    key: att.storageKey,
    fileName: att.fileName,
    contentType: att.contentType,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  await recordAudit(db, ctx, {
    action: "attachment.downloaded",
    entityType: "ticket",
    entityId: att.ticket.id,
    metadata: { key: att.ticket.key, attachmentId: att.id },
  });
  return url;
}

/** Uploader, or anyone who can update tickets, may remove a file. */
export async function deleteAttachment(ctx: OrgContext, raw: unknown): Promise<void> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const { attachmentId } = parseInput(attachmentIdSchema, raw);
  const db = scopedDb(ctx.organization.id);
  const att = await db.attachment.findFirst({
    where: {
      id: attachmentId,
      deletedAt: null,
      ticket: readScope(ctx),
      ...(canSeeInternal(ctx) ? {} : { visibility: "PUBLIC" as const }),
    },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      uploadedById: true,
      ticket: { select: { id: true, key: true } },
    },
  });
  if (!att) throw new NotFoundError("File not found.");
  if (att.uploadedById !== ctx.user.id && !can(ctx, "tickets.update")) {
    throw new AuthorizationError("You can only remove files you uploaded.");
  }
  await db.$transaction(async (tx) => {
    await tx.attachment.updateMany({ where: { id: att.id }, data: { status: "DELETED", deletedAt: new Date() } });
    await recordAudit(tx, ctx, {
      action: "attachment.deleted",
      entityType: "ticket",
      entityId: att.ticket.id,
      metadata: { key: att.ticket.key, attachmentId: att.id, fileName: att.fileName },
    });
  });
  // Metadata is authoritative; object removal is best-effort (a cleanup job
  // in Phase 4 sweeps DELETED rows whose objects remain).
  await getStorage()
    .delete(att.storageKey)
    .catch((err) => logger.warn("attachment object delete failed", { operation: "attachment.delete", error: err }));
}
