import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { get, list } from "@vercel/blob";
import {
  buildAuditPath,
  isAuditConfigured,
  sanitizePathSegment,
} from "./_lib.js";
import { authorizeAuditRunRead } from "./_runAccess.js";

async function streamBuffer(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function fnv1a32(buffer) {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function readEvent(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  try {
    return JSON.parse((await streamBuffer(blob.stream)).toString("utf8"));
  } catch {
    return null;
  }
}

async function findDescriptor(runId, pathname, filename) {
  const result = await list({ prefix: buildAuditPath(runId, "events", ""), limit: 100, mode: "expanded" });
  const events = [...result.blobs].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  for (const blob of events) {
    const event = await readEvent(blob.pathname);
    const artifact = event?.eventType === "analysis-snapshot" ? event?.payload?.artifact : null;
    if (artifact && (artifact.pathname === pathname || artifact.filename === filename)) return artifact;
  }
  return null;
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({ error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel." });
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  const runId = typeof request.query?.runId === "string" ? sanitizePathSegment(request.query.runId) : null;
  const pathname = typeof request.query?.pathname === "string" ? request.query.pathname : null;
  if (!runId || !pathname || !pathname.startsWith(buildAuditPath(runId, "artifacts", ""))) {
    response.status(400).json({ error: "A valid runId and run-scoped artifact pathname are required." });
    return;
  }
  const access = await authorizeAuditRunRead(request, { runId });
  if (!access.authorized) {
    response.status(401).json({ error: "Unauthorized run artifact access.", reason: access.mode });
    return;
  }
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }
  const stored = await streamBuffer(result.stream);
  const filename = pathname.split("/").pop() || "artifact.bin";
  if (request.query?.download === "1") {
    response.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
    response.status(200).send(stored);
    return;
  }
  const descriptor = await findDescriptor(runId, pathname, filename);
  const encoding = descriptor?.contentEncoding ?? (filename.endsWith(".gz") ? "gzip" : null);
  let decoded;
  try {
    decoded = encoding === "gzip" ? gunzipSync(stored) : stored;
  } catch {
    response.status(200).json({
      ok: true,
      artifact: { pathname, filename, storedBytes: stored.byteLength, contentEncoding: encoding },
      verification: { status: "invalid-compression", expectedHash: descriptor?.contentHash ?? null, actualHash: null },
      snapshotSummary: null,
    });
    return;
  }
  const algorithm = descriptor?.contentHashAlgorithm ?? "sha256";
  const actualHash = algorithm === "fnv1a32-fallback"
    ? fnv1a32(decoded)
    : crypto.createHash("sha256").update(decoded).digest("hex");
  const expectedHash = descriptor?.contentHash ?? null;
  let parsed = null;
  try {
    const value = JSON.parse(decoded.toString("utf8"));
    parsed = value && typeof value === "object" ? value : null;
  } catch {
    parsed = null;
  }
  response.status(200).json({
    ok: true,
    artifact: {
      pathname,
      filename,
      contentType: result.blob.contentType || descriptor?.contentType || "application/octet-stream",
      contentEncoding: encoding,
      storedBytes: stored.byteLength,
      uploadedAt: result.blob.uploadedAt,
    },
    verification: {
      status: !expectedHash ? "unverifiable" : expectedHash === actualHash ? "verified" : "mismatch",
      expectedHash,
      actualHash,
      algorithm,
      decodedBytes: decoded.byteLength,
      parsed: parsed !== null,
    },
    snapshotSummary: parsed ? {
      schemaVersion: parsed.schemaVersion ?? null,
      companyId: parsed.companyId ?? null,
      family: parsed.family ?? null,
      periodCount: parsed.periodCount ?? null,
      latestPeriod: parsed.latestPeriod ?? null,
      policyVersions: parsed.policyVersions ?? null,
    } : null,
  });
}
