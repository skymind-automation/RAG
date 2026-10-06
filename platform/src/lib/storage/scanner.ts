/**
 * Malware scanning hook. The default scanner performs no scan and says so
 * (`SKIPPED`), the same "a no-op must report itself" rule the retrieval layer
 * follows. A real implementation (ClamAV sidecar, GuardDuty Malware
 * Protection for S3, a vendor API) returns CLEAN / INFECTED, or PENDING when
 * scanning is asynchronous — the attachment then stays PENDING_SCAN and is not
 * downloadable until a background job (Phase 4) records the verdict.
 */
export type ScanVerdict = "CLEAN" | "INFECTED" | "SKIPPED" | "PENDING";

export interface MalwareScanner {
  readonly name: string;
  scan(input: { storageKey: string; contentType: string; sizeBytes: number }): Promise<ScanVerdict>;
}

export const noopScanner: MalwareScanner = {
  name: "none",
  async scan() {
    return "SKIPPED";
  },
};

let scanner: MalwareScanner = noopScanner;

export function getScanner(): MalwareScanner {
  return scanner;
}

export function __setScannerForTests(s: MalwareScanner | null): void {
  scanner = s ?? noopScanner;
}
