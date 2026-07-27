import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import marketDataRouter from "./routes/marketData";
import auditRouter from "./routes/audit";
import researchRouter from "./routes/research";
import { readJson, writeJson } from "./store/fsStore";

const app = express();
const PORT = Number(process.env.LOCAL_SERVER_PORT ?? 3001);

/** Reject path segments containing traversal or separators. */
function isSafeSegment(s: string): boolean {
  return !/[/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
}

// ── Local-mode auth + CSRF helpers ────────────────────────────────────
//
// The local Express server runs on the user's machine. Even bound to
// localhost, a hostile webpage opened in the same browser can issue
// requests to it. We harden two ways:
//
//   1) `requireLocalAuditAuth` — when LOCAL_AUDIT_TOKEN is set, every
//      request must present `x-audit-token` matching it (timing-safe
//      compared). When the env var is unset, we no-op (preserves the
//      zero-config dev experience for users who haven't set a token).
//
//   2) `requireLocalCsrfHeader` — every request must carry
//      `x-penman-local: 1`. Browsers block custom headers on cross-
//      origin no-cors fetches, so this single line blocks drive-by
//      writes from hostile pages even when no token is configured.

function timingSafeStringEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  // Hash both values to a fixed 32-byte digest before comparing so the
  // early-return path cannot leak the token length via response timing.
  const aHash = crypto.createHash("sha256").update(String(a)).digest();
  const bHash = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * Returns true (and lets the request continue) if LOCAL_AUDIT_TOKEN is unset
 * OR the presented `x-audit-token` header matches it via constant-time compare.
 * Otherwise responds 401 and returns false so the caller can `return` early.
 */
export function requireLocalAuditAuth(req: express.Request, res: express.Response): boolean {
  const configured = process.env.LOCAL_AUDIT_TOKEN;
  if (!configured) return true;
  const presentedRaw = req.headers["x-audit-token"];
  const presented = Array.isArray(presentedRaw) ? presentedRaw[0] : presentedRaw;
  if (timingSafeStringEqual(presented ?? null, configured)) return true;
  res.status(401).json({ ok: false, error: "Unauthorized — invalid or missing x-audit-token." });
  return false;
}

/**
 * Requires the `x-penman-local: 1` header on every API request. Browsers cannot
 * set custom headers on cross-origin no-cors fetches, so this blocks drive-by
 * writes from hostile pages even when LOCAL_AUDIT_TOKEN is unset. The Vite
 * frontend adds this header in its fetch wrapper; curl/Postman callers must
 * pass `-H "x-penman-local: 1"` (documented in .env.local.example).
 */
export function requireLocalCsrfHeader(req: express.Request, res: express.Response): boolean {
  const headerRaw = req.headers["x-penman-local"];
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (header === "1") return true;
  res.status(403).json({ ok: false, error: "Missing required x-penman-local header." });
  return false;
}

/** Combined gate used as Express middleware on every API route. */
function localApiGate(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!requireLocalCsrfHeader(req, res)) return;
  if (!requireLocalAuditAuth(req, res)) return;
  next();
}

// ── Security hardening ────────────────────────────────────────────────
//
// This server binds to localhost and serves the user's own Vite dev session.
// Even so, treat it as a real HTTP surface — a hostile webpage opened in the
// same browser can issue requests to localhost:3001 unless we constrain it.
//
// 1) CORS: allow only loopback origins. The dev server may be reached from
//    127.0.0.1 or localhost (with or without an explicit port), and in
//    LAN-debug mode from the host's own IP. Any other origin is rejected.
//    When Origin is missing (curl/Postman/server-to-server callers) we
//    additionally require the `x-penman-local` CSRF header, so a hostile
//    page making a no-cors request without Origin is still rejected.
// 2) Helmet: standard security headers (X-Content-Type-Options, etc.).
//    crossOriginResourcePolicy is permissive because the API serves JSON
//    consumed by the same-origin Vite dev server.
// 3) Per-IP rate limit + local CSRF/auth run BEFORE body parsing. This
//    prevents drive-by oversized JSON posts from hostile browser pages from
//    consuming parser memory.
// 4) Body limit: authenticated local workspace/comparison-registry sync can
//    legitimately exceed 2mb because registry records carry raw/recast data
//    for comparison. Keep it bounded (10mb), but not so low that DMART-sized
//    local analysis snapshots fail.
// 5) Per-IP rate limit: 600 req/min/IP — generous for normal use, blocks
//    runaway loops or hostile pages from saturating the data store.

const ALLOWED_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const corsAllowLanIp = process.env.LOCAL_SERVER_ALLOW_LAN_IP || ""; // e.g. "192.168.1.42"
if (corsAllowLanIp) ALLOWED_ORIGIN_HOSTS.add(corsAllowLanIp);

app.use(helmet({
  // The API returns JSON only and is consumed by the local Vite frontend; a
  // strict default-src CSP from the API itself is unnecessary, but keep the
  // other headers (XSS, MIME sniffing, frame, referrer).
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin(origin, callback) {
    // Tools like curl / server-to-server callers send no Origin header.
    // Allow only when paired with the X-Penman-Local CSRF header — the
    // request-level middleware enforces the header presence; here we just
    // permit the CORS layer to pass through. Browsers' no-cors fetches
    // also send no Origin, but they cannot set custom headers, so the
    // localApiGate below will still reject them.
    if (!origin) return callback(null, true);
    try {
      const u = new URL(origin);
      if (ALLOWED_ORIGIN_HOSTS.has(u.hostname)) return callback(null, true);
    } catch {
      // Invalid Origin header — reject.
    }
    return callback(new Error(`Origin '${origin}' not permitted by local CORS policy.`));
  },
  credentials: false,
}));

const LOCAL_JSON_BODY_LIMIT = process.env.LOCAL_JSON_BODY_LIMIT ?? "10mb";
// The /api/research endpoint handles comparison-registry sync which carries
// raw/recast data for multiple companies. A 30-company portfolio can easily
// exceed 10MB. Allow up to 50MB on that route specifically; other routes
// keep the tighter global limit.
const RESEARCH_JSON_BODY_LIMIT = process.env.RESEARCH_JSON_BODY_LIMIT ?? "50mb";

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — local rate limit exceeded." },
});
app.use("/api/", apiLimiter);

// Local-mode auth + CSRF gate. Applied BEFORE JSON body parsing and route
// mounts so every /api/* path requires the x-penman-local header (and
// x-audit-token when LOCAL_AUDIT_TOKEN is set). The /api/health endpoint
// below is also gated.
app.use("/api/", localApiGate);

// Research route gets a higher body limit for multi-company comparison payloads.
// This override must run before the global 10MB parser, otherwise the tighter limit
// intercepts and rejects large payloads with 413 (Payload Too Large).
app.use("/api/research", express.json({ limit: RESEARCH_JSON_BODY_LIMIT }), researchRouter);

// Parse other local API JSON using the standard 10MB limit.
app.use("/api/", express.json({ limit: LOCAL_JSON_BODY_LIMIT }));

// Routes — mirror the Vercel api/ structure
app.use("/api/market-data", marketDataRouter);
app.use("/api/audit", auditRouter);

// Blackboard (simple key-value)
app.get("/api/blackboard", async (req, res) => {
  const session = (req.query.session as string) ?? "default";
  if (!isSafeSegment(session)) return res.status(400).json({ ok: false, error: "Invalid session parameter." });
  const filePath = path.join(os.homedir(), ".penman-data", "blackboard", `${session}.json`);
  try {
    const data = await readJson(filePath);
    res.json({ ok: true, data: data ?? {} });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "Read failed." });
  }
});

app.put("/api/blackboard", async (req, res) => {
  const session = (req.query.session as string) ?? "default";
  if (!isSafeSegment(session)) return res.status(400).json({ ok: false, error: "Invalid session parameter." });
  const filePath = path.join(os.homedir(), ".penman-data", "blackboard", `${session}.json`);
  try {
    await writeJson(filePath, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "Write failed." });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "local",
    timestamp: new Date().toISOString(),
    dataDir: `~/.penman-data/`,
  });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === "entity.too.large") {
    console.error(`[413 Payload Too Large] Path: ${_req.path}, BaseUrl: ${_req.baseUrl}, Method: ${_req.method}, Length: ${_req.headers["content-length"]}`);
    const isResearch = _req.path.includes("/research") || _req.baseUrl?.includes("/research");
    const isAuditBlob = _req.path.includes("/audit/blobs") || _req.originalUrl?.includes("/api/audit/blobs");
    const activeLimit = isAuditBlob
      ? process.env.LOCAL_AUDIT_BLOB_LIMIT ?? "64mb"
      : isResearch ? RESEARCH_JSON_BODY_LIMIT : LOCAL_JSON_BODY_LIMIT;
    const envHint = isAuditBlob
      ? "LOCAL_AUDIT_BLOB_LIMIT"
      : isResearch ? "RESEARCH_JSON_BODY_LIMIT" : "LOCAL_JSON_BODY_LIMIT";
    res.status(413).json({
      ok: false,
      error: `Request body too large. Limit: ${activeLimit}. Override with ${envHint} env var.`,
      debug: { path: _req.path, baseUrl: _req.baseUrl, originalUrl: _req.originalUrl }
    });
    return;
  }
  console.error("[server error]", err?.message ?? err);
  res.status(500).json({ ok: false, error: "Internal server error." });
});

// Bind to localhost only by default so only your machine can reach the API.
// Set LOCAL_SERVER_BIND=0.0.0.0 (or any interface) only if you deliberately
// want LAN exposure — e.g. testing from another device on your Wi-Fi.
const HOST = process.env.LOCAL_SERVER_BIND ?? "127.0.0.1";

// Start
app.listen(PORT, HOST, () => {
  console.log(`\n  🏠 Penman local server running at http://${HOST}:${PORT}`);
  console.log(`  📁 Data stored in ~/.penman-data/`);
  console.log(`  📊 Market data: NSE India (no API key needed)`);
  console.log(`  🔗 Vite proxy should forward /api/* here\n`);
});

export { isSafeSegment };
