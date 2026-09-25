import { handleUpload } from "@vercel/blob/client";
import {
  assertContentLength,
  buildAuditPath,
  enforceAuditRateLimit,
  getAuditGovernanceConfig,
  hashAuditToken,
  isAuditConfigured,
  logAudit,
  readJsonBody,
  resolveRetentionDays,
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

const UPLOAD_KINDS = new Set(["inputs", "artifacts"]);

function uploadRejection(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * Pin a client upload to the one path its run capability covers.
 *
 * `handleUpload` mints the client token for the pathname the CLIENT asked for,
 * so authorizing the run id in `clientPayload` authorizes nothing unless the
 * pathname is proven to sit under that run. Without this check any visitor —
 * run capabilities are self-issued on first write — could create blobs under
 * another run's prefix or inside `research-store/`. Content types are the
 * server's list (a client may narrow it, never widen it) and the completion
 * callback is never taken from the client.
 */
export function resolveUploadTarget(pathname, payload, governance) {
  if (typeof payload.runId !== "string" || !payload.runId.trim()) {
    throw uploadRejection("runId is required for audit uploads.");
  }
  const runId = sanitizePathSegment(payload.runId);
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  if (!UPLOAD_KINDS.has(kind)) {
    throw uploadRejection("Audit upload kind must be inputs or artifacts.");
  }
  if (typeof payload.filename !== "string" || !payload.filename.trim()) {
    throw uploadRejection("filename is required for audit uploads.");
  }
  const filename = sanitizePathSegment(payload.filename);
  const expectedPathname = buildAuditPath(runId, kind, filename);
  if (pathname !== expectedPathname) {
    throw uploadRejection(`Upload pathname must be ${expectedPathname}.`);
  }

  const serverTypes = resolveAllowedContentTypes(kind);
  const requestedTypes = Array.isArray(payload.allowedContentTypes) ? payload.allowedContentTypes : null;
  const allowedContentTypes = requestedTypes
    ? serverTypes.filter((type) => requestedTypes.includes(type))
    : serverTypes;
  if (!allowedContentTypes.length) {
    throw uploadRejection("None of the requested content types are allowed for this upload kind.");
  }

  return {
    runId,
    kind,
    filename,
    pathname: expectedPathname,
    allowedContentTypes,
    maximumSizeInBytes: Math.min(
      Number(payload.maximumSizeInBytes) || governance.maxUploadBytes,
      governance.maxUploadBytes,
    ),
    retentionDays: resolveRetentionDays(payload.retentionDays, governance.retentionDays),
  };
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
      // `_multipart` is unused but kept to document @vercel/blob's callback
      // signature; the underscore is what argsIgnorePattern expects.
      onBeforeGenerateToken: async (pathname, clientPayload, _multipart) => {
        let payload;
        try {
          payload = clientPayload ? JSON.parse(clientPayload) : {};
        } catch {
          throw uploadRejection("clientPayload must be JSON.");
        }
        const target = resolveUploadTarget(pathname, payload ?? {}, governance);
        const access = await authorizeAuditRunWrite(request, {
          runId: target.runId,
          runAccessToken: payload.runAccessToken ?? null,
        });
        if (!access.authorized) {
          const error = new Error("Unauthorized audit run upload.");
          error.statusCode = 401;
          throw error;
        }

        return {
          allowedContentTypes: target.allowedContentTypes,
          maximumSizeInBytes: target.maximumSizeInBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            runId: target.runId,
            kind: target.kind,
            filename: target.filename,
            eventType: payload.eventType ?? "blob-upload",
            companyId: payload.companyId ?? null,
            sourceMode: payload.sourceMode ?? null,
            idempotencyKey: payload.idempotencyKey ?? null,
            runAccessHash: hashAuditToken(payload.runAccessToken ?? null),
            contentClass: payload.contentClass ?? governance.contentClass,
            retentionDays: target.retentionDays,
          }),
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
