import express, { Router, Request, Response } from "express";
import {
  readJson, writeJson, writeBuffer, listFiles,
  auditRunPath, auditEventDir, auditEventPath, auditUploadPath, auditBlobPath, runsDir,
} from "../store/fsStore";
import { buildLocalInspectorPayload } from "../store/localAuditInspector";
import { readAndVerifyLocalArtifact } from "../store/auditArtifacts";
import { cleanupLocalAuditStorage, maybeCleanupLocalAuditStorage } from "../store/auditLifecycle";
import * as crypto from "node:crypto";

const router = Router();

/** Reject path segments containing traversal or separators. */
function isSafeSegment(s: string): boolean {
  return !/[\/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
}

function requestHeader(req: Request, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function runTokenHash(req: Request, bodyToken?: unknown): string | null {
  const token = requestHeader(req, "x-audit-run-token") || (typeof bodyToken === "string" ? bodyToken : "");
  return token ? crypto.createHash("sha256").update(token).digest("hex") : null;
}

function safeHashEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorizeLocalRunRead(req: Request, runId: string): Promise<boolean> {
  const run = await readJson<{ runAccessHash?: string | null }>(auditRunPath(runId));
  if (!run) return false;
  if (!run.runAccessHash) return true;
  return safeHashEqual(run.runAccessHash, runTokenHash(req));
}

// POST /api/audit/events — store an audit event
router.post("/events", async (req: Request, res: Response) => {
  const { runId, eventType, companyId, sourceMode, payload, runAccessToken, contentClass, retentionDays } = req.body ?? {};
  if (!runId) return res.status(400).json({ error: "runId required" });
  if (!isSafeSegment(runId)) return res.status(400).json({ error: "Invalid runId." });

  const eventId = crypto.randomUUID();
  const accessHash = runTokenHash(req, runAccessToken);
  const createdAt = new Date().toISOString();
  const event = {
    eventId,
    runId,
    eventType,
    companyId,
    sourceMode,
    payload,
    timestamp: createdAt,
    createdAt,
    runAccessHash: accessHash,
    contentClass: contentClass ?? null,
    retentionDays: Number(retentionDays) || 45,
  };

  // Events are append-only by eventId, so no version check is needed for them.
  await writeJson(auditEventPath(runId, eventId), event);

  // Run metadata is read-modify-written and races between concurrent writers.
  // Use an optimistic-concurrency loop: re-read on conflict and retry up to
  // 3 times before surfacing 409. The fs store has no atomic compare-and-swap
  // so this is best-effort, but it materially shrinks the lost-update window.
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    const runMeta: any = (await readJson<any>(auditRunPath(runId))) ?? {
      runId,
      companyId,
      sourceMode,
      startedAt: event.timestamp,
      eventCount: 0,
      version: 0,
      runAccessHash: accessHash,
      contentClass: contentClass ?? null,
      retentionDays: Number(retentionDays) || 45,
    };
    const expectedVersion = typeof runMeta.version === "number" ? runMeta.version : 0;

    const next = {
      ...runMeta,
      eventCount: (runMeta.eventCount ?? 0) + 1,
      lastEventAt: event.timestamp,
      lastEventType: eventType,
      version: expectedVersion + 1,
      runAccessHash: runMeta.runAccessHash ?? accessHash,
      contentClass: runMeta.contentClass ?? contentClass ?? null,
      retentionDays: runMeta.retentionDays ?? (Number(retentionDays) || 45),
    };

    // Re-read just before writing as a cheap mismatch check; fs has no atomic
    // CAS, so concurrent writers in the same tick can still interleave, but
    // the recheck shrinks the window and lets us retry deterministically.
    const reread: any = await readJson<any>(auditRunPath(runId));
    const actualVersion = reread && typeof reread.version === "number" ? reread.version : 0;
    if (actualVersion !== expectedVersion) {
      if (attempts >= 3) {
        return res.status(409).json({
          error: "Run metadata version conflict — retry exhausted.",
          expectedVersion,
          actualVersion,
        });
      }
      continue;
    }
    await writeJson(auditRunPath(runId), next);
    break;
  }

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

// POST /api/audit/blobs — local binary persistence for source inputs and
// compressed analysis artifacts. The browser sends application/octet-stream
// so the global JSON parser never attempts to materialize a multi-megabyte
// artifact as an audit event.
router.post(
  "/blobs",
  express.raw({ type: "application/octet-stream", limit: process.env.LOCAL_AUDIT_BLOB_LIMIT ?? "64mb" }),
  async (req: Request, res: Response) => {
    const header = (name: string): string => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    };
    const runId = header("x-audit-run-id");
    const filename = header("x-audit-filename");
    const kind = header("x-audit-kind");
    if (!isSafeSegment(runId) || !isSafeSegment(filename)) {
      return res.status(400).json({ ok: false, error: "Invalid audit run or filename." });
    }
    if (kind !== "inputs" && kind !== "artifacts") {
      return res.status(400).json({ ok: false, error: "Audit blob kind must be inputs or artifacts." });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ ok: false, error: "Binary audit body required." });
    }

    const blobPath = auditBlobPath(runId, kind, filename);
    await writeBuffer(blobPath, req.body);
    await writeJson(`${blobPath}.meta.json`, {
      runId,
      kind,
      filename,
      eventType: header("x-audit-event-type") || "blob-upload",
      companyId: header("x-audit-company-id") || null,
      sourceMode: header("x-audit-source-mode") || null,
      contentType: header("x-audit-content-type") || "application/octet-stream",
      contentEncoding: header("x-audit-content-encoding") || null,
      contentClass: header("x-audit-content-class") || null,
      retentionDays: Number(header("x-audit-retention-days")) || 45,
      size: req.body.length,
      uploadedAt: new Date().toISOString(),
    });
    void maybeCleanupLocalAuditStorage();

    return res.json({
      ok: true,
      path: `audit/${kind}/${runId}/${filename}`,
      size: req.body.length,
    });
  },
);

// GET /api/audit/inspector — run inspector data
router.get("/artifacts", async (req: Request, res: Response) => {
  const runId = typeof req.query.runId === "string" ? req.query.runId : "";
  const pathname = typeof req.query.pathname === "string" ? req.query.pathname : "";
  if (!isSafeSegment(runId) || !pathname) return res.status(400).json({ error: "runId and pathname are required." });
  if (!await authorizeLocalRunRead(req, runId)) return res.status(401).json({ error: "Unauthorized run artifact access." });
  const result = await readAndVerifyLocalArtifact(runId, pathname);
  if (!result) return res.status(404).json({ error: "Artifact not found." });
  if (req.query.download === "1") {
    const filename = result.descriptor?.filename ?? pathname.split("/").pop() ?? "artifact.bin";
    res.setHeader("Content-Type", result.meta?.contentType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
    res.setHeader("x-audit-content-encoding", result.meta?.contentEncoding ?? "");
    return res.send(result.stored);
  }
  return res.json({
    ok: true,
    artifact: {
      pathname,
      filename: result.descriptor?.filename ?? pathname.split("/").pop(),
      contentType: result.meta?.contentType ?? result.descriptor?.contentType ?? "application/octet-stream",
      contentEncoding: result.meta?.contentEncoding ?? result.descriptor?.contentEncoding ?? null,
      storedBytes: result.stored.byteLength,
      uploadedAt: result.meta?.uploadedAt ?? null,
    },
    verification: result.verification,
    snapshotSummary: result.snapshotSummary,
  });
});

router.get("/inspector", async (req: Request, res: Response) => {
  const runId = typeof req.query.runId === "string" ? req.query.runId : "";
  if (!isSafeSegment(runId)) return res.status(400).json({ error: "runId is required." });
  if (!await authorizeLocalRunRead(req, runId)) return res.status(401).json({ error: "Unauthorized run inspector access." });
  await maybeCleanupLocalAuditStorage();
  return res.json(await buildLocalInspectorPayload(runId));
});

router.post("/retention", async (_req: Request, res: Response) => {
  return res.json({ ok: true, report: await cleanupLocalAuditStorage() });
});

// GET /api/audit/monitor — health check
router.get("/monitor", async (_req: Request, res: Response) => {
  return res.json({ ok: true, mode: "local", timestamp: new Date().toISOString() });
});

export default router;
