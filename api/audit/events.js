import { get, list, put } from "@vercel/blob";
import {
  assertContentLength,
  buildAuditPath,
  enforceAuditRateLimit,
  getAuditGovernanceConfig,
  hashAuditToken,
  isAuditConfigured,
  logAudit,
  nowStamp,
  readJsonBody,
  requireAuditReadAuth,
  respondJsonBodyError,
  sanitizePathSegment,
} from "./_lib.js";

async function streamToBuffer(stream) {
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({
      error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
    return;
  }

  if (request.method === "POST") {
    if (!requireAuditReadAuth(request, response)) return;
    const governance = getAuditGovernanceConfig();
    if (!assertContentLength(request, response, governance.maxEventBytes)) return;
    if (!enforceAuditRateLimit(request, response, "events", governance.maxEventsPerMinute)) return;

    let body;
    try {
      body = await readJsonBody(request, governance.maxEventBytes);
    } catch (error) {
      if (respondJsonBodyError(response, error)) return;
      throw error;
    }
    const runId = sanitizePathSegment(body.runId, `run-${Date.now()}`);
    const eventType = sanitizePathSegment(body.eventType, "event");
    const idempotencyKey = body.idempotencyKey ? sanitizePathSegment(body.idempotencyKey) : null;
    const filename = idempotencyKey ? `${eventType}-${idempotencyKey}.json` : `${nowStamp()}-${eventType}.json`;
    const pathname = buildAuditPath(runId, "events", filename);

    if (idempotencyKey) {
      const existing = await get(pathname, { access: "private" });
      if (existing?.statusCode === 200) {
        response.status(200).json({
          ok: true,
          deduped: true,
          runId,
          pathname,
          url: existing.blob?.url ?? null,
        });
        return;
      }
    }

    const payload = {
      runId,
      eventType,
      companyId: body.companyId ?? null,
      sourceMode: body.sourceMode ?? null,
      createdAt: new Date().toISOString(),
      idempotencyKey,
      runAccessHash: hashAuditToken(body.runAccessToken ?? null),
      contentClass: body.contentClass ?? governance.contentClass,
      retentionDays: Number(body.retentionDays) || governance.retentionDays,
      payload: body.payload ?? {},
    };

    const blob = await put(pathname, JSON.stringify(payload, null, 2), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    logAudit("event.persisted", {
      runId,
      eventType,
      pathname: blob.pathname,
      companyId: payload.companyId,
      sourceMode: payload.sourceMode,
      contentClass: payload.contentClass,
      retentionDays: payload.retentionDays,
    });

    response.status(200).json({
      ok: true,
      runId,
      pathname: blob.pathname,
      url: blob.url,
    });
    return;
  }

  if (request.method === "GET") {
    if (!requireAuditReadAuth(request, response)) return;

    const query = request.query ?? {};
    const runId = typeof query.runId === "string" ? sanitizePathSegment(query.runId) : null;
    const kind = typeof query.kind === "string" ? sanitizePathSegment(query.kind) : null;
    const pathname = typeof query.pathname === "string" ? query.pathname : null;
    const limit =
      typeof query.limit === "string" && Number.isFinite(Number(query.limit))
        ? Math.min(Math.max(Number(query.limit), 1), 100)
        : 25;

    if (pathname) {
      const blob = await get(pathname, { access: "private" });
      if (!blob || blob.statusCode !== 200 || !blob.stream) {
        response.status(404).json({ error: "Audit blob not found." });
        return;
      }

      const buffer = await streamToBuffer(blob.stream);
      const contentType = blob.blob.contentType || "application/octet-stream";

      response.status(200).json({
        pathname: blob.blob.pathname,
        contentType,
        size: blob.blob.size,
        uploadedAt: blob.blob.uploadedAt,
        text: contentType.startsWith("text/") || contentType.includes("json")
          ? buffer.toString("utf8")
          : null,
        base64: contentType.startsWith("text/") || contentType.includes("json")
          ? null
          : buffer.toString("base64"),
      });
      return;
    }

    const prefixParts = ["audit-runs"];
    if (runId) prefixParts.push(runId);
    if (kind) prefixParts.push(kind);

    const result = await list({
      limit,
      prefix: prefixParts.join("/"),
      mode: "expanded",
    });

    response.status(200).json({
      blobs: result.blobs.map((blob) => ({
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
        url: blob.url,
        downloadUrl: blob.downloadUrl,
      })),
      cursor: result.cursor ?? null,
      hasMore: result.hasMore,
    });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
