import { describe, expect, it } from "vitest";
import { inferContentType } from "@/lib/attachments";
import { ValidationError } from "@/lib/errors";
import { decodeLocalToken, encodeLocalToken, LocalStorageProvider } from "@/lib/storage/local";
import { S3StorageProvider } from "@/lib/storage/s3";
import { attachmentDisposition } from "@/lib/storage/types";
import { sanitizeFileName, validateUpload } from "@/server/attachments/attachment-service";
import { validateCustomFields, type CustomFieldDefinitionLike } from "@/server/tickets/custom-fields";

process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef0123456789";

const defs: CustomFieldDefinitionLike[] = [
  { key: "site", label: "Site", type: "SELECT", options: ["A", "B"], required: false, ticketTypes: [] },
  { key: "count", label: "Count", type: "NUMBER", options: [], required: false, ticketTypes: [] },
  { key: "tag", label: "Tag", type: "TEXT", options: [], required: true, ticketTypes: ["INCIDENT"] },
  { key: "on", label: "On", type: "CHECKBOX", options: [], required: false, ticketTypes: [] },
  { key: "when", label: "When", type: "DATE", options: [], required: false, ticketTypes: [] },
];

describe("validateCustomFields", () => {
  it("coerces and validates each type", () => {
    expect(
      validateCustomFields(defs, "INCIDENT", {}, { tag: " x ", count: "3", on: "true", when: "2026-10-01", site: "B" }),
    ).toEqual({
      tag: "x",
      count: 3,
      on: true,
      when: "2026-10-01",
      site: "B",
    });
  });

  it("reports every problem keyed by field", () => {
    try {
      validateCustomFields(defs, "INCIDENT", {}, { site: "C", count: "x", when: "01/10/2026", nope: 1 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(Object.keys((e as ValidationError).fieldErrors).sort()).toEqual(
        [
          "customFields.count",
          "customFields.nope",
          "customFields.site",
          "customFields.tag",
          "customFields.when",
        ].sort(),
      );
    }
  });

  it("applies requiredness per ticket type and merges with existing values", () => {
    expect(validateCustomFields(defs, "TASK", {}, {})).toEqual({});
    expect(validateCustomFields(defs, "INCIDENT", { tag: "keep", site: "A" }, { site: null })).toEqual({ tag: "keep" });
    // Values for fields that don't apply to the (new) type are dropped.
    expect(validateCustomFields(defs, "TASK", { tag: "x", count: 1 }, {})).toEqual({ count: 1 });
  });
});

describe("upload validation", () => {
  it("sanitizes names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("...hidden")).toBe("hidden");
    expect(sanitizeFileName('a<b>:"c|?*.txt')).toBe("a_b___c___.txt");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("enforces the type allowlist and extension/type agreement", () => {
    expect(validateUpload("a.PNG", "image/png", 10)).toEqual({ fileName: "a.PNG", contentType: "image/png" });
    expect(() => validateUpload("a.svg", "image/svg+xml", 10)).toThrow(ValidationError);
    expect(() => validateUpload("a", "text/plain", 10)).toThrow(ValidationError);
    expect(() => validateUpload("a.pdf.exe", "application/pdf", 10)).toThrow(ValidationError);
    expect(() => validateUpload("a.png", "text/html", 10)).toThrow(ValidationError);
  });

  it("infers a safe content type when the browser gives none", () => {
    expect(inferContentType("trace.log", "")).toBe("text/plain");
    expect(inferContentType("x.csv", "application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
    expect(inferContentType("x.png", "text/html")).toBe("image/png");
  });

  it("builds a safe Content-Disposition for any name", () => {
    expect(attachmentDisposition('évil"\r\n.pdf')).toBe(
      `attachment; filename="_vil___.pdf"; filename*=UTF-8''%C3%A9vil%22%0D%0A.pdf`,
    );
  });
});

describe("local storage tokens", () => {
  const key = "org/abc123/tickets/def456/0123456789abcdef01234567";
  it("round-trips and rejects tampering, expiry and bad keys", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const t = encodeLocalToken({ k: key, op: "get", exp, ct: "text/plain" });
    expect(decodeLocalToken(t)).toMatchObject({ k: key, op: "get" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ k: key, op: "put", exp, ct: "text/html", len: 9 })).toString(
      "base64url",
    );
    expect(decodeLocalToken(`${forged}.${sig}`)).toBeNull();
    expect(decodeLocalToken(`${payload}.${sig!.slice(0, -1)}A`)).toBeNull();
    expect(decodeLocalToken(encodeLocalToken({ k: key, op: "get", exp: 1, ct: "text/plain" }))).toBeNull();
    expect(decodeLocalToken(encodeLocalToken({ k: "../../etc/passwd", op: "get", exp, ct: "text/plain" }))).toBeNull();
  });

  it("refuses keys that escape the storage root", () => {
    const p = new LocalStorageProvider("/tmp/root", "http://x");
    expect(() => p.pathFor("org/a/tickets/b/../../../x")).toThrow();
    expect(p.pathFor(key)).toBe(`/tmp/root/${key}`);
  });
});

describe("S3 presigning (offline)", () => {
  const s3 = new S3StorageProvider("bucket", {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    region: "auto",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret",
  });

  it("signs content-type and content-length into upload URLs", async () => {
    const up = await s3.presignUpload({
      key: "org/a/tickets/b/c",
      contentType: "application/pdf",
      sizeBytes: 1234,
      expiresInSeconds: 300,
    });
    const url = new URL(up.url);
    expect(url.pathname).toBe("/bucket/org/a/tickets/b/c");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";").sort()).toEqual([
      "content-length",
      "content-type",
      "host",
    ]);
    expect(up.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("forces attachment disposition on downloads", async () => {
    const url = new URL(
      await s3.presignDownload({
        key: "org/a/tickets/b/c",
        fileName: "r.pdf",
        contentType: "application/pdf",
        expiresInSeconds: 60,
      }),
    );
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
  });
});
