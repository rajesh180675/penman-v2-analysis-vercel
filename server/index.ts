import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
  return !/[\/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
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
// 2) Helmet: standard security headers (X-Content-Type-Options, etc.).
//    crossOriginResourcePolicy is permissive because the API serves JSON
//    consumed by the same-origin Vite dev server.
// 3) Body limit: dropped from 50mb (DoS-y) to 2mb. The audit pipeline
//    handles large uploads via Vercel Blob, not via this endpoint.
// 4) Per-IP rate limit: 600 req/min/IP — generous for normal use, blocks
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
    // Tools like curl / server-to-server callers send no Origin header — allow.
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

app.use(express.json({ limit: "2mb" }));

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — local rate limit exceeded." },
});
app.use("/api/", apiLimiter);

// Routes — mirror the Vercel api/ structure
app.use("/api/market-data", marketDataRouter);
app.use("/api/audit", auditRouter);
app.use("/api/research", researchRouter);

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
  console.error("[server error]", err?.message ?? err);
  res.status(500).json({ ok: false, error: "Internal server error." });
});

// Start
app.listen(PORT, () => {
  console.log(`\n  🏠 Penman local server running at http://localhost:${PORT}`);
  console.log(`  📁 Data stored in ~/.penman-data/`);
  console.log(`  📊 Market data: NSE India (no API key needed)`);
  console.log(`  🔗 Vite proxy should forward /api/* here\n`);
});

export { isSafeSegment };
