import { get, list } from "@vercel/blob";
import {
  extractEventTypeFromPath,
  extractKindFromPath,
  extractRunIdFromPath,
  isAuditConfigured,
  requireAuditReadAuth,
  sanitizePathSegment,
} from "./_lib.js";

async function readBlobJson(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return JSON.parse(text);
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload ?? null;

  const summary = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      summary[key] = value.length > 300 ? `${value.slice(0, 300)}...` : value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = { count: value.length };
      continue;
    }
    if (value && typeof value === "object") {
      summary[key] = { keys: Object.keys(value).slice(0, 20) };
      continue;
    }
    summary[key] = value;
  }

  return summary;
}

function sortDescByUploadedAt(items) {
  return items.sort((a, b) => {
    const left = new Date(a.uploadedAt || 0).getTime();
    const right = new Date(b.uploadedAt || 0).getTime();
    return right - left;
  });
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({
      error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!requireAuditReadAuth(request, response)) return;

  const query = request.query ?? {};
  const runId = typeof query.runId === "string" ? sanitizePathSegment(query.runId) : null;
  const limit =
    typeof query.limit === "string" && Number.isFinite(Number(query.limit))
      ? Math.min(Math.max(Number(query.limit), 1), 200)
      : 50;

  if (!runId) {
    const result = await list({
      prefix: "audit-runs/",
      limit,
      mode: "expanded",
    });

    const grouped = new Map();
    for (const blob of result.blobs) {
      const blobRunId = extractRunIdFromPath(blob.pathname);
      if (!blobRunId) continue;
      const kind = extractKindFromPath(blob.pathname) ?? "unknown";
      const group = grouped.get(blobRunId) ?? {
        runId: blobRunId,
        latestAt: blob.uploadedAt,
        counts: { events: 0, inputs: 0, artifacts: 0, unknown: 0 },
        latestEventType: extractEventTypeFromPath(blob.pathname),
        companyId: null,
        sourceMode: null,
      };
      group.latestAt = new Date(blob.uploadedAt).toISOString() > new Date(group.latestAt).toISOString()
        ? blob.uploadedAt
        : group.latestAt;
      group.counts[kind] = (group.counts[kind] ?? 0) + 1;
      if (kind === "events" && !group.latestEventType) {
        group.latestEventType = extractEventTypeFromPath(blob.pathname);
      }
      grouped.set(blobRunId, group);
    }

    response.status(200).json({
      runs: Array.from(grouped.values()).sort((a, b) => {
        return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
      }),
      cursor: result.cursor ?? null,
      hasMore: result.hasMore,
    });
    return;
  }

  const result = await list({
    prefix: `audit-runs/${runId}/`,
    limit,
    mode: "expanded",
  });
  const blobs = sortDescByUploadedAt([...result.blobs]);
  const eventBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "events");
  const artifactBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "artifacts");
  const inputBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "inputs");

  const timeline = [];
  for (const blob of eventBlobs.slice(0, Math.min(eventBlobs.length, 25))) {
    try {
      const parsed = await readBlobJson(blob.pathname);
      timeline.push({
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        eventType: parsed?.eventType ?? extractEventTypeFromPath(blob.pathname),
        companyId: parsed?.companyId ?? null,
        sourceMode: parsed?.sourceMode ?? null,
        createdAt: parsed?.createdAt ?? blob.uploadedAt,
        payloadSummary: summarizePayload(parsed?.payload),
      });
    } catch {
      timeline.push({
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        eventType: extractEventTypeFromPath(blob.pathname),
        companyId: null,
        sourceMode: null,
        createdAt: blob.uploadedAt,
        payloadSummary: null,
      });
    }
  }

  const latest = timeline[0] ?? null;
  response.status(200).json({
    runId,
    latestEventType: latest?.eventType ?? null,
    latestAt: latest?.createdAt ?? blobs[0]?.uploadedAt ?? null,
    counts: {
      events: eventBlobs.length,
      inputs: inputBlobs.length,
      artifacts: artifactBlobs.length,
    },
    inputs: inputBlobs.slice(0, 10).map((blob) => ({
      pathname: blob.pathname,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
      url: blob.url,
    })),
    artifacts: artifactBlobs.slice(0, 10).map((blob) => ({
      pathname: blob.pathname,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
      url: blob.url,
    })),
    timeline,
    cursor: result.cursor ?? null,
    hasMore: result.hasMore,
  });
}
