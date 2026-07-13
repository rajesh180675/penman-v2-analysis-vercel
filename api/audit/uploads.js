import { handleUpload } from "@vercel/blob/client";
import {
  assertContentLength,
  enforceAuditRateLimit,
  getAuditGovernanceConfig,
  hashAuditToken,
  isAuditConfigured,
  logAudit,
  readJsonBody,
  respondJsonBodyError,
  sanitizePathSegment,
} from "./_lib.js";
import { authorizeAuditRunWrite } from "./_runAccess.js";

function resolveAllowedContentTypes(kind) {
  if (kind === "inputs") {
    return [
      "application/zip",
      "application/json",
      "application/xml",
      "text/xml",
      "text/plain",
      "application/octet-stream",
    ];
  }

  return [
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "application/zip",
    "application/octet-stream",
  ];
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({
      error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const governance = getAuditGovernanceConfig();
  if (!assertContentLength(request, response, governance.maxEventBytes)) return;
  let body;
  try {
    body = await readJsonBody(request, governance.maxEventBytes);
  } catch (error) {
    if (respondJsonBodyError(response, error)) return;
    throw error;
  }

  if (!enforceAuditRateLimit(request, response, "uploads", governance.maxUploadsPerMinute)) return;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const payload = clientPayload ? JSON.parse(clientPayload) : {};
        const runId = sanitizePathSegment(payload.runId, `run-${Date.now()}`);
        const kind = sanitizePathSegment(payload.kind, "artifacts");
        const filename = sanitizePathSegment(payload.filename || pathname, "blob.bin");
        const access = await authorizeAuditRunWrite(request, {
          runId,
          runAccessToken: payload.runAccessToken ?? null,
        });
        if (!access.authorized) {
          const error = new Error("Unauthorized audit run upload.");
          error.statusCode = 401;
          throw error;
        }
        const maximumSizeInBytes = Math.min(
          Number(payload.maximumSizeInBytes) || governance.maxUploadBytes,
          governance.maxUploadBytes,
        );

        return {
          allowedContentTypes: payload.allowedContentTypes ?? resolveAllowedContentTypes(kind),
          maximumSizeInBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            runId,
            kind,
            filename,
            eventType: payload.eventType ?? "blob-upload",
            companyId: payload.companyId ?? null,
            sourceMode: payload.sourceMode ?? null,
            idempotencyKey: payload.idempotencyKey ?? null,
            runAccessHash: hashAuditToken(payload.runAccessToken ?? null),
            contentClass: payload.contentClass ?? governance.contentClass,
            retentionDays: Number(payload.retentionDays) || governance.retentionDays,
          }),
          callbackUrl: payload.callbackUrl,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = tokenPayload ? JSON.parse(tokenPayload) : {};
        logAudit("blob.persisted", {
          runId: payload.runId ?? null,
          kind: payload.kind ?? null,
          pathname: blob.pathname,
          eventType: payload.eventType ?? null,
          companyId: payload.companyId ?? null,
          sourceMode: payload.sourceMode ?? null,
          contentClass: payload.contentClass ?? governance.contentClass,
          retentionDays: payload.retentionDays ?? governance.retentionDays,
        });
      },
    });

    response.status(200).json(json);
  } catch (error) {
    console.error("[audit] upload failed", error);
    response.status(error?.statusCode === 401 ? 401 : 400).json({
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
}
