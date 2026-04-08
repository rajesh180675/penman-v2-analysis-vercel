import { get, list, put } from "@vercel/blob";
import {
  assertContentLength,
  enforceAuditRateLimit,
  isAuditConfigured,
  readJsonBody,
  requireAuditReadAuth,
  sanitizePathSegment,
} from "../audit/_lib.js";

const PREFIX = "research-store";

export function isResearchConfigured() {
  return isAuditConfigured();
}

export function researchPath(...parts) {
  return [PREFIX, ...parts.map((part) => sanitizePathSegment(part))].join("/");
}

export function shouldRequireResearchReadAuth() {
  return (process.env.RESEARCH_REQUIRE_READ_AUTH ?? "false").toLowerCase() === "true";
}

export function shouldRequireResearchWriteAuth() {
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
  return requireAuditReadAuth(request, response);
}

export async function readResearchBody(request, response, limitBytes = 1024 * 1024) {
  if (!assertContentLength(request, response, limitBytes)) return null;
  if (!enforceAuditRateLimit(request, response, "research", 180)) return null;
  return await readJsonBody(request);
}

export async function readJsonBlob(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return JSON.parse(text);
}

export async function writeJsonBlob(pathname, payload) {
  return put(pathname, JSON.stringify(payload, null, 2), {
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
