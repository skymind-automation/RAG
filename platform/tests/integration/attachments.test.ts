import { beforeEach, describe, expect, it } from "vitest";
import { PUT as localPut, GET as localGet } from "@/app/api/storage/local/route";
import { prisma } from "@/lib/db/client";
import { NotFoundError, AuthorizationError, ValidationError } from "@/lib/errors";
import { __setScannerForTests } from "@/lib/storage/scanner";
import type { OrgContext } from "@/server/context";
import {
  confirmUpload,
  deleteAttachment,
  getDownloadUrl,
  listTicketAttachments,
  requestUpload,
} from "@/server/attachments/attachment-service";
import { addComment, createTicket } from "@/server/tickets/ticket-service";
import { getTicketTimeline } from "@/server/tickets/timeline-service";
import { joinAs, makeOrg, resetDb } from "./helpers";

/** Simulate the browser's direct-to-storage PUT against the presigned URL. */
async function putBytes(
  upload: { url: string; headers: Record<string, string> },
  bytes: Uint8Array,
  contentType?: string,
) {
  return localPut(
    new Request(upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType ?? upload.headers["Content-Type"]!,
        "Content-Length": String(bytes.byteLength),
      },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    }),
  );
}

async function uploadFile(
  ctx: OrgContext,
  ticketId: string,
  name = "screenshot.png",
  type = "image/png",
  bytes = new Uint8Array([1, 2, 3, 4]),
  visibility: "PUBLIC" | "INTERNAL" = "PUBLIC",
) {
  const { attachmentId, upload } = await requestUpload(ctx, {
    ticketId,
    fileName: name,
    contentType: type,
    sizeBytes: bytes.byteLength,
    visibility,
  });
  const res = await putBytes(upload, bytes);
  expect(res.status).toBe(200);
  await confirmUpload(ctx, { attachmentId });
  return attachmentId;
}

describe("attachments", () => {
  let owner: OrgContext;
  let requester: OrgContext;
  let other: OrgContext;
  let ticketId: string;

  beforeEach(async () => {
    await resetDb();
    __setScannerForTests(null);
    owner = await makeOrg("Acme IT", "acme");
    requester = await joinAs(owner, "REQUESTER", "req");
    other = await makeOrg("Beta Corp", "beta");
    ticketId = (await createTicket(requester, { type: "INCIDENT", title: "Laptop screen flickers" })).id;
  });

  describe("validation", () => {
    it("rejects disallowed types, mismatched MIME and oversize files", async () => {
      const base = { ticketId, sizeBytes: 10 };
      await expect(
        requestUpload(owner, { ...base, fileName: "run.exe", contentType: "application/octet-stream" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        requestUpload(owner, { ...base, fileName: "page.html", contentType: "text/html" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        requestUpload(owner, { ...base, fileName: "logo.svg", contentType: "image/svg+xml" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        requestUpload(owner, { ...base, fileName: "photo.png", contentType: "application/pdf" }),
      ).rejects.toMatchObject({
        fieldErrors: { contentType: [expect.stringMatching(/doesn't match/)] },
      });
      await expect(
        requestUpload(owner, {
          ticketId,
          fileName: "big.pdf",
          contentType: "application/pdf",
          sizeBytes: 26 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ fieldErrors: { sizeBytes: [expect.any(String)] } });
    });

    it("never puts the file name into the storage key, and ties the key to the tenant", async () => {
      const { attachmentId } = await requestUpload(owner, {
        ticketId,
        fileName: "../../etc/passwd.txt",
        contentType: "text/plain",
        sizeBytes: 3,
      });
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row.storageKey).toMatch(new RegExp(`^org/${owner.organization.id}/tickets/${ticketId}/[a-f0-9]{24}$`));
      expect(row.fileName).toBe("passwd.txt");
      await expect(
        prisma.attachment.update({
          where: { id: attachmentId },
          data: { storageKey: `org/${other.organization.id}/x` },
        }),
      ).rejects.toThrow(/attachments_storage_key_tenant_chk/);
    });
  });

  describe("upload flow", () => {
    it("uploads, confirms and serves a file through presigned URLs", async () => {
      const bytes = new TextEncoder().encode("hello world");
      const id = await uploadFile(requester, ticketId, "notes.txt", "text/plain", bytes);
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "AVAILABLE", scanStatus: "SKIPPED", visibility: "PUBLIC" });

      const url = await getDownloadUrl(owner, { attachmentId: id });
      const res = await localGet(new Request(url));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="notes.txt"/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.text()).toBe("hello world");
      expect(await prisma.auditLog.count({ where: { action: "attachment.downloaded" } })).toBe(1);
    });

    it("refuses confirmation when nothing (or the wrong size) was uploaded", async () => {
      const { attachmentId } = await requestUpload(owner, {
        ticketId,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 5,
      });
      await expect(confirmUpload(owner, { attachmentId })).rejects.toBeInstanceOf(ValidationError);
      expect((await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).status).toBe("DELETED");
    });

    it("the storage endpoint enforces the signed content type, size and token", async () => {
      const { upload } = await requestUpload(owner, {
        ticketId,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
      });
      expect((await putBytes(upload, new Uint8Array(4), "text/html")).status).toBe(403);
      expect((await putBytes(upload, new Uint8Array(8))).status).toBe(403);
      const tampered = { ...upload, url: upload.url.replace(/.(?=$)/, (c) => (c === "A" ? "B" : "A")) };
      expect((await putBytes(tampered, new Uint8Array(4))).status).toBe(403);
      expect((await putBytes(upload, new Uint8Array(4))).status).toBe(200);
    });

    it("only the uploader can confirm, and pending files are never downloadable", async () => {
      const { attachmentId, upload } = await requestUpload(owner, {
        ticketId,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
      });
      await putBytes(upload, new Uint8Array(4));
      const agent = await joinAs(owner, "AGENT");
      await expect(confirmUpload(agent, { attachmentId })).rejects.toBeInstanceOf(NotFoundError);
      await expect(getDownloadUrl(owner, { attachmentId })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("quarantines files the scanner flags and never serves them", async () => {
      __setScannerForTests({ name: "test-av", scan: async () => "INFECTED" });
      const { attachmentId, upload } = await requestUpload(owner, {
        ticketId,
        fileName: "a.zip",
        contentType: "application/zip",
        sizeBytes: 4,
      });
      await putBytes(upload, new Uint8Array(4));
      await expect(confirmUpload(owner, { attachmentId })).rejects.toThrow(/malware/);
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(row).toMatchObject({ status: "QUARANTINED", scanStatus: "INFECTED" });
      await expect(getDownloadUrl(owner, { attachmentId })).rejects.toBeInstanceOf(NotFoundError);
      expect(await prisma.auditLog.count({ where: { action: "attachment.quarantined" } })).toBe(1);
    });
  });

  describe("authorization and isolation", () => {
    it("requesters can only upload to their own tickets", async () => {
      const staffTicket = await createTicket(owner, { type: "TASK", title: "Rotate keys" });
      await expect(
        requestUpload(requester, {
          ticketId: staffTicket.id,
          fileName: "a.png",
          contentType: "image/png",
          sizeBytes: 4,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        requestUpload(requester, {
          ticketId,
          fileName: "a.png",
          contentType: "image/png",
          sizeBytes: 4,
          visibility: "INTERNAL",
        }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("Organization A cannot upload to, list, or download Organization B's files", async () => {
      const id = await uploadFile(requester, ticketId);
      await expect(
        requestUpload(other, { ticketId, fileName: "a.png", contentType: "image/png", sizeBytes: 4 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(listTicketAttachments(other, ticketId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getDownloadUrl(other, { attachmentId: id })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteAttachment(other, { attachmentId: id })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("internal files are invisible to requesters everywhere", async () => {
      const internalId = await uploadFile(
        owner,
        ticketId,
        "vendor-contract.pdf",
        "application/pdf",
        new Uint8Array(6),
        "INTERNAL",
      );
      const publicId = await uploadFile(owner, ticketId, "steps.pdf", "application/pdf", new Uint8Array(6));
      await addComment(owner, {
        ticketId,
        body: "contract attached",
        visibility: "INTERNAL",
        attachmentIds: [internalId],
      });
      await addComment(owner, { ticketId, body: "Try these steps", attachmentIds: [publicId] });

      expect((await listTicketAttachments(requester, ticketId)).map((a) => a.id)).toEqual([publicId]);
      await expect(getDownloadUrl(requester, { attachmentId: internalId })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteAttachment(requester, { attachmentId: internalId })).rejects.toBeInstanceOf(NotFoundError);
      const timeline = JSON.stringify(await getTicketTimeline(requester, ticketId));
      expect(timeline).not.toContain("vendor-contract");
      expect(timeline).toContain("steps.pdf");
      expect((await listTicketAttachments(owner, ticketId)).map((a) => a.id).sort()).toEqual(
        [internalId, publicId].sort(),
      );
    });

    it("attaching to a comment requires your own, confirmed upload on the same ticket", async () => {
      const agent = await joinAs(owner, "AGENT");
      const mine = await uploadFile(owner, ticketId);
      await expect(addComment(agent, { ticketId, body: "x", attachmentIds: [mine] })).rejects.toBeInstanceOf(
        ValidationError,
      );
      const pending = await requestUpload(owner, {
        ticketId,
        fileName: "p.png",
        contentType: "image/png",
        sizeBytes: 4,
      });
      await expect(
        addComment(owner, { ticketId, body: "x", attachmentIds: [pending.attachmentId] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("only the uploader or an agent can delete a file", async () => {
      const id = await uploadFile(owner, ticketId);
      const requesterFile = await uploadFile(requester, ticketId);
      await expect(deleteAttachment(requester, { attachmentId: id })).rejects.toBeInstanceOf(AuthorizationError);
      await deleteAttachment(requester, { attachmentId: requesterFile });
      await deleteAttachment(owner, { attachmentId: id });
      expect(await listTicketAttachments(owner, ticketId)).toEqual([]);
    });
  });
});
