import { upload } from "@vercel/blob/client";

export interface AuditSubmissionMeta {
  runId: string;
  sourceMode: "capitaline" | "screener" | "json" | "xbrl" | "manual" | "sample";
  companyId: string;
  fileName?: string | null;
}

interface AuditEventInput {
  runId: string;
  eventType: string;
  companyId?: string | null;
  sourceMode?: string | null;
  payload: unknown;
}

interface AuditBlobInput {
  runId: string;
  kind: "inputs" | "artifacts";
  eventType: string;
  file: Blob;
  filename: string;
  companyId?: string | null;
  sourceMode?: string | null;
  contentType?: string;
}

const AUDIT_ENABLED =
  (import.meta.env.VITE_AUDIT_CAPTURE_ENABLED ?? "true").toLowerCase() !== "false";

export function createAuditRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAuditEnabled() {
  return AUDIT_ENABLED;
}

export async function persistAuditEvent(input: AuditEventInput) {
  if (!AUDIT_ENABLED) return null;

  try {
    const response = await fetch("/api/audit/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Audit event failed with ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn("[audit] event persistence skipped", error);
    return null;
  }
}

export async function persistAuditBlob(input: AuditBlobInput) {
  if (!AUDIT_ENABLED) return null;

  try {
    const pathname = `audit-runs/${input.runId}/${input.kind}/${input.filename}`;

    return await upload(pathname, input.file, {
      access: "private",
      contentType: input.contentType || input.file.type || "application/octet-stream",
      handleUploadUrl: "/api/audit/uploads",
      clientPayload: JSON.stringify({
        runId: input.runId,
        kind: input.kind,
        eventType: input.eventType,
        companyId: input.companyId ?? null,
        sourceMode: input.sourceMode ?? null,
        filename: input.filename,
      }),
    });
  } catch (error) {
    console.warn("[audit] blob persistence skipped", error);
    return null;
  }
}

export async function persistAuditFile(input: Omit<AuditBlobInput, "file"> & { file: File }) {
  return persistAuditBlob(input);
}
