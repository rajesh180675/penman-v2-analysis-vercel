const AUDIT_PREFIX = "audit-runs";

export function isAuditConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function getAuditReadToken(request) {
  const headerToken = request.headers["x-audit-token"] || request.headers["X-Audit-Token"];
  if (Array.isArray(headerToken)) return headerToken[0] ?? null;
  return headerToken ?? null;
}

export function requireAuditReadAuth(request, response) {
  const configuredToken = process.env.AUDIT_ADMIN_TOKEN;
  if (!configuredToken) return true;
  if (getAuditReadToken(request) === configuredToken) return true;

  response.status(401).json({ error: "Unauthorized audit read." });
  return false;
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
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
