import crypto from "node:crypto";

const AUDIT_PREFIX = "audit-runs";
const RATE_LIMIT_STATE = globalThis.__penmanAuditRateLimitState || new Map();

if (!globalThis.__penmanAuditRateLimitState) {
  globalThis.__penmanAuditRateLimitState = RATE_LIMIT_STATE;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function isAuditConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function isAuditAdminAuthRequired() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL || process.env.VERCEL_ENV);
}

export function getAuditGovernanceConfig() {
  return {
    retentionDays: clampNumber(process.env.AUDIT_RETENTION_DAYS, 45, 1, 365),
    contentClass: (process.env.AUDIT_SENSITIVE_DOCUMENT_CLASS || "confidential-financial-statements").trim(),
    maxEventBytes: clampNumber(process.env.AUDIT_MAX_EVENT_BYTES, 8 * 1024 * 1024, 16 * 1024, 32 * 1024 * 1024),
    maxUploadBytes: clampNumber(process.env.AUDIT_MAX_UPLOAD_BYTES, 64 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024),
    maxEventsPerMinute: clampNumber(process.env.AUDIT_MAX_EVENTS_PER_MINUTE, 120, 10, 2000),
    maxUploadsPerMinute: clampNumber(process.env.AUDIT_MAX_UPLOADS_PER_MINUTE, 24, 1, 500),
    runInspectorEnabled: (process.env.AUDIT_RUN_INSPECTOR_ENABLED ?? "true").toLowerCase() !== "false",
    adminTokenVersion: (process.env.AUDIT_ADMIN_TOKEN_VERSION || "current").trim(),
    previousAdminTokenVersion: process.env.AUDIT_ADMIN_TOKEN_PREVIOUS_VERSION?.trim() || null,
  };
}

export function getAuditReadToken(request) {
  const headerToken = request.headers["x-audit-token"] || request.headers["X-Audit-Token"];
  if (Array.isArray(headerToken)) return headerToken[0] ?? null;
  return headerToken ?? null;
}

function safeTokenEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireAuditReadAuth(request, response) {
  const configuredToken = process.env.AUDIT_ADMIN_TOKEN;
  const previousToken = process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
  const presented = getAuditReadToken(request);

  if (!configuredToken && !previousToken) {
    if (isAuditAdminAuthRequired()) {
      response.status(503).json({ error: "Audit admin token is required in deployed or blob-backed mode." });
      return false;
    }
    return true;
  }
  if (safeTokenEqual(presented, configuredToken) || safeTokenEqual(presented, previousToken)) return true;

  response.status(401).json({ error: "Unauthorized audit read." });
  return false;
}

/**
 * Gates audit write paths (and any caller that wants to enforce a distinct
 * write-only token). Reads from AUDIT_ADMIN_WRITE_TOKEN when set, otherwise
 * falls back to AUDIT_ADMIN_TOKEN — so single-token deployments continue to
 * work unchanged. The fallback is intentional: separate read and write tokens
 * are an opt-in hardening for deployments that want to scope blast radius.
 *
 * Compares via safeTokenEqual (constant-time). Returns true on success;
 * responds with 401 (or 503 when the token is required by environment but
 * unset) and returns false on failure.
 */
export function requireAuditWriteAuth(request, response) {
  const configuredWriteToken = process.env.AUDIT_ADMIN_WRITE_TOKEN || process.env.AUDIT_ADMIN_TOKEN;
  const previousToken = process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
  const presented = getAuditReadToken(request);

  if (!configuredWriteToken && !previousToken) {
    if (isAuditAdminAuthRequired()) {
      response.status(503).json({ error: "Audit admin token is required in deployed or blob-backed mode." });
      return false;
    }
    return true;
  }
  if (safeTokenEqual(presented, configuredWriteToken) || safeTokenEqual(presented, previousToken)) return true;

  response.status(401).json({ error: "Unauthorized audit write." });
  return false;
}

export function isAuditReadAuthorized(request) {
  const configuredToken = process.env.AUDIT_ADMIN_TOKEN;
  const previousToken = process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
  const presented = getAuditReadToken(request);

  if (!configuredToken && !previousToken) return !isAuditAdminAuthRequired();
  return safeTokenEqual(presented, configuredToken) || safeTokenEqual(presented, previousToken);
}

export function isAuditWriteAuthorized(request) {
  const configuredToken = process.env.AUDIT_ADMIN_WRITE_TOKEN || process.env.AUDIT_ADMIN_TOKEN;
  const previousToken = process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
  const presented = getAuditReadToken(request);

  if (!configuredToken && !previousToken) return !isAuditAdminAuthRequired();
  return safeTokenEqual(presented, configuredToken) || safeTokenEqual(presented, previousToken);
}

export function getRunAccessToken(request) {
  const headerToken = request.headers["x-audit-run-token"] || request.headers["X-Audit-Run-Token"];
  if (typeof headerToken === "string" && headerToken) return headerToken;
  if (Array.isArray(headerToken) && headerToken[0]) return headerToken[0];
  if (typeof request.query?.runToken === "string" && request.query.runToken) return request.query.runToken;
  return null;
}

export function hashAuditToken(token) {
  if (!token) return null;
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export async function readJsonBody(request, maxBytes = 8 * 1024 * 1024) {
  if (request.body && typeof request.body === "object") {
    const bodyBytes = Buffer.byteLength(JSON.stringify(request.body), "utf8");
    if (bodyBytes > maxBytes) {
      const error = new Error(`Payload too large. Limit is ${maxBytes} bytes.`);
      error.statusCode = 413;
      error.limitBytes = maxBytes;
      throw error;
    }
    return request.body;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      const error = new Error(`Payload too large. Limit is ${maxBytes} bytes.`);
      error.statusCode = 413;
      error.limitBytes = maxBytes;
      throw error;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export function respondJsonBodyError(response, error) {
  if (error?.statusCode === 413) {
    response.status(413).json({
      error: error.message,
      limitBytes: error.limitBytes,
    });
    return true;
  }
  return false;
}

export function buildAuditPath(runId, kind, filename) {
  return `${AUDIT_PREFIX}/${runId}/${kind}/${filename}`;
}

export function extractRunIdFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const parts = pathname.split("/");
  if (parts[0] !== AUDIT_PREFIX || parts.length < 2) return null;
  return parts[1] || null;
}

export function extractKindFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const parts = pathname.split("/");
  if (parts[0] !== AUDIT_PREFIX || parts.length < 3) return null;
  return parts[2] || null;
}

export function extractFilenameFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const parts = pathname.split("/");
  return parts[parts.length - 1] || null;
}

export function extractEventTypeFromPath(pathname) {
  const filename = extractFilenameFromPath(pathname);
  if (!filename) return null;
  const match = filename.match(/^\d{4}-\d{2}-\d{2}T.+?-(.+)\.json$/);
  return match?.[1] ?? null;
}

export function sanitizePathSegment(value, fallback = "unknown") {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function logAudit(event, details) {
  console.log(
    "[audit]",
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...details,
    })
  );
}

export function assertContentLength(request, response, maxBytes) {
  const header = request.headers["content-length"] || request.headers["Content-Length"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return true;
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= maxBytes) return true;
  response.status(413).json({
    error: `Payload too large. Limit is ${maxBytes} bytes.`,
    limitBytes: maxBytes,
  });
  return false;
}

function getRequesterKey(request) {
  const forwarded = request.headers["x-forwarded-for"] || request.headers["X-Forwarded-For"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedValue) return forwardedValue.split(",")[0].trim();
  return request.socket?.remoteAddress || "unknown";
}

export function enforceAuditRateLimit(request, response, bucket, limit) {
  const key = `${bucket}:${getRequesterKey(request)}`;
  const now = Date.now();
  const windowMs = 60_000;
  const current = RATE_LIMIT_STATE.get(key);
  if (!current || current.expiresAt <= now) {
    RATE_LIMIT_STATE.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    response.status(429).json({
      error: "Audit rate limit exceeded.",
      bucket,
      retryAfterMs: Math.max(0, current.expiresAt - now),
    });
    return false;
  }

  current.count += 1;
  RATE_LIMIT_STATE.set(key, current);
  return true;
}
