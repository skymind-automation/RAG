/**
 * Attachment type policy, shared by the browser (accept attribute, type
 * inference) and the server (authoritative validation). Executable or
 * active-content types (html, svg, js, exe…) are deliberately absent.
 */
export const ALLOWED_TYPES: Readonly<Record<string, readonly string[]>> = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  log: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  json: ["application/json"],
  zip: ["application/zip", "application/x-zip-compressed"],
  eml: ["message/rfc822"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
};

export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_TYPES)
  .map((e) => `.${e}`)
  .join(",");

export function extensionOf(fileName: string): string {
  return fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
}

/**
 * Browsers report an empty or generic type for some files (.log, .md, .eml).
 * Use the browser's type when it's allowed for the extension, otherwise the
 * extension's canonical type. The server re-validates either way.
 */
export function inferContentType(fileName: string, browserType: string): string {
  const allowed = ALLOWED_TYPES[extensionOf(fileName)];
  if (!allowed) return browserType || "application/octet-stream";
  const t = browserType.toLowerCase();
  return allowed.includes(t) ? t : allowed[0]!;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
