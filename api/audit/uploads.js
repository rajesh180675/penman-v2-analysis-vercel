import { handleUpload } from "@vercel/blob/client";
import { isAuditConfigured, logAudit, readJsonBody, sanitizePathSegment } from "./_lib.js";

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

  const body = await readJsonBody(request);

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const payload = clientPayload ? JSON.parse(clientPayload) : {};
        const runId = sanitizePathSegment(payload.runId, `run-${Date.now()}`);
        const kind = sanitizePathSegment(payload.kind, "artifacts");
        const filename = sanitizePathSegment(payload.filename || pathname, "blob.bin");

        return {
          allowedContentTypes: payload.allowedContentTypes ?? [
            "application/zip",
            "application/json",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/csv",
            "text/plain",
            "application/octet-stream",
          ],
          maximumSizeInBytes: Number(payload.maximumSizeInBytes) || 1024 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            runId,
            kind,
            filename,
            eventType: payload.eventType ?? "blob-upload",
            companyId: payload.companyId ?? null,
            sourceMode: payload.sourceMode ?? null,
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
        });
      },
    });

    response.status(200).json(json);
  } catch (error) {
    console.error("[audit] upload failed", error);
    response.status(400).json({
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
}
