import crypto from "node:crypto";
import { get, put } from "@vercel/blob";
import {
  buildAuditPath,
  getRunAccessToken,
  hashAuditToken,
  isAuditReadAuthorized,
  isAuditWriteAuthorized,
} from "./_lib.js";

const MIN_RUN_TOKEN_LENGTH = 32;
const MAX_RUN_TOKEN_LENGTH = 512;

function accessPath(runId) {
  return buildAuditPath(runId, "access", "manifest.json");
}

function safeHashEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function readAccessManifest(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  try {
    return JSON.parse(await new Response(result.stream).text());
  } catch {
    return null;
  }
}

function resolveRunToken(request, bodyToken) {
  const token = getRunAccessToken(request) || bodyToken;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (trimmed.length < MIN_RUN_TOKEN_LENGTH || trimmed.length > MAX_RUN_TOKEN_LENGTH) return null;
  return trimmed;
}

/**
 * Authorize a write using either the server-side administrator credential or a
 * run-scoped capability token. The first valid capability presented for an
 * unpredictable run id establishes an immutable SHA-256 manifest; subsequent
 * writes must present the same capability. Raw capability tokens are never
 * persisted.
 */
export async function authorizeAuditRunWrite(request, { runId, runAccessToken = null }) {
  if (isAuditWriteAuthorized(request)) return { authorized: true, mode: "admin" };

  const token = resolveRunToken(request, runAccessToken);
  if (!token) return { authorized: false, mode: "missing-run-capability" };

  const pathname = accessPath(runId);
  const tokenHash = hashAuditToken(token);
  const existing = await readAccessManifest(pathname);
  if (existing) {
    return {
      authorized: safeHashEqual(existing.runAccessHash, tokenHash),
      mode: "run-capability",
    };
  }

  const manifest = {
    schemaVersion: "audit-run-access-v1",
    runId,
    runAccessHash: tokenHash,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(pathname, JSON.stringify(manifest), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { authorized: true, mode: "run-capability-created" };
  } catch {
    // A concurrent first write may have created the manifest. Re-read and
    // accept only if it established the same capability.
    const raced = await readAccessManifest(pathname);
    return {
      authorized: Boolean(raced && safeHashEqual(raced.runAccessHash, tokenHash)),
      mode: "run-capability-race",
    };
  }
}

export async function requireAuditRunWrite(request, response, options) {
  const result = await authorizeAuditRunWrite(request, options);
  if (result.authorized) return true;
  response.status(401).json({
    error: "Unauthorized audit run write.",
    reason: result.mode,
  });
  return false;
}

export async function authorizeAuditRunRead(request, { runId }) {
  if (isAuditReadAuthorized(request)) return { authorized: true, mode: "admin" };
  const token = resolveRunToken(request, null);
  if (!token) return { authorized: false, mode: "missing-run-capability" };
  const manifest = await readAccessManifest(accessPath(runId));
  if (!manifest) return { authorized: false, mode: "missing-run-manifest" };
  return {
    authorized: safeHashEqual(manifest.runAccessHash, hashAuditToken(token)),
    mode: "run-capability",
  };
}
