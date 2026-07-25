export type ReportArtifactKind = "pdf" | "xlsx" | "zip";

export interface ReportExportResult {
  readonly format: ReportArtifactKind;
  readonly filename: string;
  readonly bytes: number;
  readonly auditStatus: "stored" | "unavailable" | "not-requested";
}

export interface DownloadEnvironment {
  readonly document: Pick<Document, "body" | "createElement">;
  readonly url: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
}

const DEFAULT_REVOKE_DELAY_MS = 30_000;

export function sanitizeFilenameComponent(value: string, fallback = "company"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function sanitizeDownloadFilename(value: string, fallback = "penman-report"): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  const extensionMatch = basename.match(/\.([a-zA-Z0-9]{1,10})$/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";
  const stemSource = extensionMatch ? basename.slice(0, -extensionMatch[0].length) : basename;
  const stem = sanitizeFilenameComponent(stemSource, fallback);
  return extension ? `${stem}.${extension}` : stem;
}

export function buildReportFilename(
  companyId: string,
  latestPeriod: string,
  descriptor: "academic-report" | "institutional-workbook" | "ic-bundle",
  extension: "pdf" | "xlsx" | "zip",
): string {
  const company = sanitizeFilenameComponent(companyId);
  const period = sanitizeFilenameComponent(latestPeriod, "latest");
  return `penman-${company}-${descriptor}-${period}.${extension}`;
}

export async function assertReportArtifact(blob: Blob, kind: ReportArtifactKind): Promise<void> {
  const minimumBytes = kind === "pdf" ? 500 : 22;
  if (blob.size < minimumBytes) {
    throw new Error(`${kind.toUpperCase()} generation produced an unexpectedly small artifact (${blob.size} bytes).`);
  }
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (kind === "pdf") {
    const pdfHeader = String.fromCharCode(...signature);
    if (pdfHeader !== "%PDF-") throw new Error("PDF generation did not produce a valid %PDF- header.");
    return;
  }
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error(`${kind.toUpperCase()} generation did not produce a valid ZIP/PK container.`);
  }
}

export function downloadBlob(
  blob: Blob,
  requestedFilename: string,
  options: {
    readonly environment?: DownloadEnvironment | undefined;
    readonly revokeDelayMs?: number | undefined;
  } = {},
): { readonly filename: string; readonly bytes: number } {
  if (blob.size <= 0) throw new Error("Cannot download an empty artifact.");
  const filename = sanitizeDownloadFilename(requestedFilename);
  const environment = options.environment ?? {
    document,
    url: URL,
    schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  };
  const objectUrl = environment.url.createObjectURL(blob);
  const anchor = environment.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  anchor.rel = "noopener";
  environment.document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    environment.schedule(
      () => environment.url.revokeObjectURL(objectUrl),
      Math.max(1_000, options.revokeDelayMs ?? DEFAULT_REVOKE_DELAY_MS),
    );
  }
  return Object.freeze({ filename, bytes: blob.size });
}
