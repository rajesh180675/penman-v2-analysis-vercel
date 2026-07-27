import { Router, Request, Response } from "express";
import * as path from "node:path";
import { readJson, writeJson, listFiles, researchPath, researchDir, dataDir } from "../store/fsStore";

const router = Router();
const COMPARISON_REGISTRY_SCHEMA_VERSION = "2026-04-comparison-registry-v1";

/** Reject path segments containing traversal or separators. */
function isSafeSegment(s: string): boolean {
  return !/[/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeFileSegment(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
  return cleaned || fallback;
}

function comparisonRegistryPath(): string {
  return path.join(dataDir(), "research-store", "comparison-registry", "latest.json");
}

function companyStorePath(companyId: string, ...segments: string[]): string {
  return path.join(dataDir(), "research-store", "companies", companyId, ...segments);
}

function collectionPath(companyId: string, kind: "analysis" | "filings" | "valuations" | "journal" | "alerts", id: unknown): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return companyStorePath(companyId, kind, `${stamp}-${safeFileSegment(id, "item")}.json`);
}

async function readCollection(companyId: string, kind: "analysis" | "filings" | "valuations" | "journal" | "alerts") {
  const files = await listFiles(companyStorePath(companyId, kind));
  const rows = await Promise.all(files.slice(-80).reverse().map(f => readJson(f)));
  return rows.filter(Boolean);
}

function requireCompanyId(req: Request, res: Response): string | null {
  const companyId = typeof req.body?.companyId === "string" ? req.body.companyId.trim() : "";
  if (!companyId) {
    res.status(400).json({ error: "companyId is required." });
    return null;
  }
  if (!isSafeSegment(companyId)) {
    res.status(400).json({ error: "Invalid companyId." });
    return null;
  }
  return companyId;
}

// GET /api/research?kind=comparison-registry — production-compatible shared registry read.
// GET /api/research?companyId=DMART — production-compatible research bundle read.
// GET /api/research — legacy local list of workspace entries.
router.get("/", async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : null;
  if (kind === "comparison-registry") {
    const stored = await readJson(comparisonRegistryPath());
    return res.json(stored ?? {
      schemaVersion: COMPARISON_REGISTRY_SCHEMA_VERSION,
      storedAt: null,
      companies: {},
    });
  }

  const queryCompanyId = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  if (queryCompanyId) {
    if (!isSafeSegment(queryCompanyId)) return res.status(400).json({ error: "Invalid companyId." });
    const profile = await readJson(companyStorePath(queryCompanyId, "profile.json"));
    return res.json({
      companyId: queryCompanyId,
      profile,
      filings: await readCollection(queryCompanyId, "filings"),
      valuations: await readCollection(queryCompanyId, "valuations"),
      journal: await readCollection(queryCompanyId, "journal"),
      alerts: await readCollection(queryCompanyId, "alerts"),
      analysis: await readCollection(queryCompanyId, "analysis"),
    });
  }

  const dir = researchDir();
  const files = await listFiles(dir);
  const entries = await Promise.all(files.map(f => readJson(f)));
  return res.json({ ok: true, entries: entries.filter(Boolean) });
});

// POST /api/research — production-compatible shared research write path used by the frontend.
router.post("/", async (req: Request, res: Response) => {
  const kind = typeof req.body?.kind === "string" ? req.body.kind : null;
  if (!kind) return res.status(400).json({ error: "Research write kind is required." });

  if (kind === "comparison-registry") {
    const comparisonRegistry = isRecord(req.body?.comparisonRegistry) ? req.body.comparisonRegistry : null;
    if (!comparisonRegistry || !isRecord(comparisonRegistry.companies)) {
      return res.status(400).json({ error: "comparisonRegistry.companies is required." });
    }
    await writeJson(comparisonRegistryPath(), {
      schemaVersion: typeof comparisonRegistry.schemaVersion === "string"
        ? comparisonRegistry.schemaVersion
        : COMPARISON_REGISTRY_SCHEMA_VERSION,
      storedAt: new Date().toISOString(),
      companies: comparisonRegistry.companies,
    });
    return res.json({ ok: true, kind });
  }

  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  if (kind === "profile") {
    await writeJson(companyStorePath(companyId, "profile.json"), {
      companyId,
      issuer: req.body.issuer ?? req.body.profile?.issuer ?? null,
      notebook: req.body.notebook ?? req.body.profile?.notebook ?? null,
      portfolio: req.body.portfolio ?? req.body.profile?.portfolio ?? null,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true, companyId, kind });
  }

  if (kind === "portfolio") {
    if (!isRecord(req.body?.portfolio)) return res.status(400).json({ error: "portfolio payload is required." });
    const existing = await readJson<Record<string, unknown>>(companyStorePath(companyId, "profile.json"));
    await writeJson(companyStorePath(companyId, "profile.json"), {
      companyId,
      issuer: existing?.issuer ?? null,
      notebook: existing?.notebook ?? null,
      portfolio: req.body.portfolio,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true, companyId, kind });
  }

  const collectionByKind: Record<string, { field: string; dir: "analysis" | "filings" | "valuations" | "journal" | "alerts"; idField: string }> = {
    analysis: { field: "analysis", dir: "analysis", idField: "id" },
    filing: { field: "filing", dir: "filings", idField: "filingId" },
    valuation: { field: "valuation", dir: "valuations", idField: "id" },
    journal: { field: "journal", dir: "journal", idField: "id" },
    alert: { field: "alert", dir: "alerts", idField: "id" },
  };
  const mapping = collectionByKind[kind];
  if (!mapping) return res.status(400).json({ error: `Unsupported research write kind: ${kind}` });

  const payload = req.body?.[mapping.field];
  if (!isRecord(payload)) return res.status(400).json({ error: `${mapping.field} payload is required.` });
  await writeJson(collectionPath(companyId, mapping.dir, payload[mapping.idField]), {
    companyId,
    ...payload,
    storedAt: new Date().toISOString(),
  });
  return res.json({ ok: true, companyId, kind });
});

// GET /api/research/:companyId — legacy local workspace read.
router.get("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  if (!isSafeSegment(companyId)) return res.status(400).json({ error: "Invalid companyId." });
  const data = await readJson(researchPath(companyId));
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true, data });
});

// PUT /api/research/:companyId — legacy local workspace upsert.
router.put("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  if (!isSafeSegment(companyId)) return res.status(400).json({ error: "Invalid companyId." });

  // Optimistic-concurrency loop. The fs store has no atomic CAS, so this is
  // best-effort: read, mutate, recheck version, then write. If two writers
  // race in the same tick the second will land on a re-read; we retry up
  // to 3 times before surfacing 409 to the caller.
  let attempts = 0;
  let merged: any;
  while (attempts < 3) {
    attempts += 1;
    const existing = (await readJson<any>(researchPath(companyId))) ?? {};
    const expectedVersion = typeof existing.version === "number" ? existing.version : 0;

    merged = {
      ...existing,
      ...req.body,
      companyId,
      updatedAt: new Date().toISOString(),
      version: expectedVersion + 1,
    };

    const reread = (await readJson<any>(researchPath(companyId))) ?? {};
    const actualVersion = typeof reread.version === "number" ? reread.version : 0;
    if (actualVersion !== expectedVersion) {
      if (attempts >= 3) {
        return res.status(409).json({
          error: "Workspace version conflict — retry exhausted.",
          expectedVersion,
          actualVersion,
        });
      }
      continue;
    }
    await writeJson(researchPath(companyId), merged);
    break;
  }
  return res.json({ ok: true, data: merged });
});

// DELETE /api/research/:companyId — legacy local workspace delete.
router.delete("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  if (!isSafeSegment(companyId)) return res.status(400).json({ error: "Invalid companyId." });
  const { deleteFile: del } = await import("../store/fsStore");
  await del(researchPath(companyId));
  return res.json({ ok: true });
});

export default router;
