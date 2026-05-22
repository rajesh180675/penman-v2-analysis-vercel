import express from "express";
import cors from "cors";
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

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

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
