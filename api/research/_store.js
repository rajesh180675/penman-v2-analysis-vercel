import { get, list, put } from "@vercel/blob";
import {
  assertContentLength,
  enforceAuditRateLimit,
  isAuditAdminAuthRequired,
  isAuditConfigured,
  readJsonBody,
  respondJsonBodyError,
  requireAuditReadAuth,
  requireAuditWriteAuth,
  sanitizePathSegment,
} from "../audit/_lib.js";

const PREFIX = "research-store";

/**
 * Thrown by writeJsonBlob when an optimistic-concurrency check fails:
 * the persisted payload's `version` does not match the caller's `ifVersion`.
 * Callers should map this to a 409 Conflict response with retry guidance.
 */
export class BlobVersionMismatchError extends Error {
  constructor(pathname, expected, actual) {
    super(`Blob version mismatch at ${pathname}: expected ${expected}, found ${actual}`);
    this.name = "BlobVersionMismatchError";
    this.statusCode = 409;
    this.pathname = pathname;
    this.expectedVersion = expected;
    this.actualVersion = actual;
  }
}

export function isResearchConfigured() {
  return isAuditConfigured();
}

export function researchPath(...parts) {
  return [PREFIX, ...parts.map((part) => sanitizePathSegment(part))].join("/");
}

export function shouldRequireResearchReadAuth() {
  if (isAuditAdminAuthRequired()) return true;
  if (process.env.RESEARCH_REQUIRE_READ_AUTH != null) {
    return (process.env.RESEARCH_REQUIRE_READ_AUTH ?? "false").toLowerCase() === "true";
  }
  return Boolean(process.env.AUDIT_ADMIN_TOKEN || process.env.AUDIT_ADMIN_TOKEN_PREVIOUS);
}

export function shouldRequireResearchWriteAuth() {
  if (isAuditAdminAuthRequired()) return true;
  if (process.env.RESEARCH_REQUIRE_WRITE_AUTH != null) {
    return (process.env.RESEARCH_REQUIRE_WRITE_AUTH ?? "false").toLowerCase() === "true";
  }
  return Boolean(process.env.AUDIT_ADMIN_TOKEN || process.env.AUDIT_ADMIN_TOKEN_PREVIOUS);
}

export function maybeRequireResearchReadAuth(request, response) {
  if (!shouldRequireResearchReadAuth()) return true;
  return requireAuditReadAuth(request, response);
}

export function maybeRequireResearchWriteAuth(request, response) {
  if (!shouldRequireResearchWriteAuth()) return true;
  return requireAuditWriteAuth(request, response);
}

export async function readResearchBody(request, response, limitBytes = 1024 * 1024) {
  if (!assertContentLength(request, response, limitBytes)) return null;
  if (!enforceAuditRateLimit(request, response, "research", 180)) return null;
  try {
    return await readJsonBody(request, limitBytes);
  } catch (error) {
    if (respondJsonBodyError(response, error)) return null;
    throw error;
  }
}

export async function readJsonBlob(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return JSON.parse(text);
}

/**
 * Writes JSON to blob storage. When `options.ifVersion` is provided,
 * performs an optimistic-concurrency pre-check: reads the existing payload's
 * `version` field (default 0), compares against `ifVersion`, and throws
 * BlobVersionMismatchError when they diverge. On success the new payload is
 * written with `version: ifVersion + 1`.
 *
 * Note: Vercel Blob does not (yet) expose conditional writes; this is a
 * read-then-write pattern with a small race window. Callers that need
 * stronger guarantees should switch to a transactional KV.
 */
export async function writeJsonBlob(pathname, payload, options = {}) {
  let finalPayload = payload;
  if (options && typeof options.ifVersion === "number" && Number.isFinite(options.ifVersion)) {
    const expected = options.ifVersion;
    const existing = await readJsonBlob(pathname).catch(() => null);
    const actual = (existing && typeof existing.version === "number" && Number.isFinite(existing.version))
      ? existing.version
      : 0;
    if (actual !== expected) {
      throw new BlobVersionMismatchError(pathname, expected, actual);
    }
    finalPayload = { ...payload, version: expected + 1 };
  }
  return put(pathname, JSON.stringify(finalPayload, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function listJsonBlobs(prefix, limit = 100) {
  const result = await list({
    prefix,
    limit,
    mode: "expanded",
  });
  const items = await Promise.all(
    result.blobs.map(async (blob) => {
      const parsed = await readJsonBlob(blob.pathname).catch(() => null);
      return {
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        payload: parsed,
      };
    })
  );
  return items.sort((left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime());
}

export function buildTimestampedPath(companyId, kind, id = Date.now().toString()) {
  return researchPath("companies", companyId, kind, `${sanitizePathSegment(id)}.json`);
}
