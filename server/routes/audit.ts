import { Router, Request, Response } from "express";
import {
  readJson, writeJson, listFiles,
  auditRunPath, auditEventDir, auditEventPath, auditUploadPath, runsDir,
} from "../store/fsStore";
import * as crypto from "node:crypto";

const router = Router();

/** Reject path segments containing traversal or separators. */
function isSafeSegment(s: string): boolean {
  return !/[\/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
}

// POST /api/audit/events — store an audit event
router.post("/events", async (req: Request, res: Response) => {
  const { runId, eventType, companyId, sourceMode, payload } = req.body ?? {};
  if (!runId) return res.status(400).json({ error: "runId required" });
  if (!isSafeSegment(runId)) return res.status(400).json({ error: "Invalid runId." });

  const eventId = crypto.randomUUID();
  const event = {
    eventId,
    runId,
    eventType,
    companyId,
    sourceMode,
    payload,
    timestamp: new Date().toISOString(),
  };

  await writeJson(auditEventPath(runId, eventId), event);

  // Upsert run metadata
  const runMeta = await readJson<any>(auditRunPath(runId)) ?? {
    runId,
    companyId,
    sourceMode,
    startedAt: event.timestamp,
    eventCount: 0,
  };
  runMeta.eventCount = (runMeta.eventCount ?? 0) + 1;
  runMeta.lastEventAt = event.timestamp;
  runMeta.lastEventType = eventType;
  await writeJson(auditRunPath(runId), runMeta);

  return res.json({ ok: true, eventId });
});

// GET /api/audit/events?runId=xxx — list events for a run
router.get("/events", async (req: Request, res: Response) => {
  const runId = req.query.runId as string;
  if (!runId) return res.status(400).json({ error: "runId query param required" });
  if (!isSafeSegment(runId)) return res.status(400).json({ error: "Invalid runId." });

  const dir = auditEventDir(runId);
  const files = await listFiles(dir);
  const events = await Promise.all(files.map(f => readJson(f)));
  return res.json({ ok: true, events: events.filter(Boolean) });
});

// GET /api/audit/runs — list all runs
router.get("/runs", async (_req: Request, res: Response) => {
  const dir = runsDir();
  const files = await listFiles(dir);
  const runs = await Promise.all(files.map(f => readJson(f)));
  const sorted = runs
    .filter(Boolean)
    .sort((a: any, b: any) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return res.json({ ok: true, runs: sorted });
});

// GET /api/audit/runs/:runId — get a single run
router.get("/runs/:runId", async (req: Request, res: Response) => {
  const runId = req.params.runId as string;
  if (!isSafeSegment(runId)) return res.status(400).json({ error: "Invalid runId." });
  const run = await readJson(auditRunPath(runId));
  if (!run) return res.status(404).json({ error: "Run not found" });
  return res.json({ ok: true, run });
});

// POST /api/audit/uploads — store a file upload
router.post("/uploads", async (req: Request, res: Response) => {
  const { runId, filename } = req.body ?? {};
  if (!runId || !filename) return res.status(400).json({ error: "runId and filename required" });
  if (!isSafeSegment(runId) || !isSafeSegment(filename)) return res.status(400).json({ error: "Invalid runId or filename." });

  // For local mode, we just acknowledge — the actual file is already processed client-side
  const uploadPath = auditUploadPath(runId, filename);
  await writeJson(uploadPath + ".meta.json", {
    runId,
    filename,
    uploadedAt: new Date().toISOString(),
    size: req.body.size ?? null,
  });

  return res.json({ ok: true, path: uploadPath });
});

// GET /api/audit/inspector — run inspector data
router.get("/inspector", async (_req: Request, res: Response) => {
  const dir = runsDir();
  const files = await listFiles(dir);
  const runs = await Promise.all(files.slice(-50).map(f => readJson(f)));
  return res.json({ ok: true, runs: runs.filter(Boolean) });
});

// GET /api/audit/monitor — health check
router.get("/monitor", async (_req: Request, res: Response) => {
  return res.json({ ok: true, mode: "local", timestamp: new Date().toISOString() });
});

export default router;
