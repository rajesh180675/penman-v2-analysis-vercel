import { Router, Request, Response } from "express";
import { readJson, writeJson, listFiles, researchPath, researchDir } from "../store/fsStore";

const router = Router();

/** Reject path segments containing traversal or separators. */
function isSafeSegment(s: string): boolean {
  return !/[\/\\]/.test(s) && !s.includes("..") && s.length > 0 && s.length < 128;
}

// GET /api/research — list all workspace entries
router.get("/", async (_req: Request, res: Response) => {
  const dir = researchDir();
  const files = await listFiles(dir);
  const entries = await Promise.all(files.map(f => readJson(f)));
  return res.json({ ok: true, entries: entries.filter(Boolean) });
});

// GET /api/research/:companyId — get workspace for a company
router.get("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  if (!isSafeSegment(companyId)) return res.status(400).json({ error: "Invalid companyId." });
  const data = await readJson(researchPath(companyId));
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true, data });
});

// PUT /api/research/:companyId — upsert workspace for a company
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

// DELETE /api/research/:companyId — delete workspace
router.delete("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  if (!isSafeSegment(companyId)) return res.status(400).json({ error: "Invalid companyId." });
  const { deleteFile: del } = await import("../store/fsStore");
  await del(researchPath(companyId));
  return res.json({ ok: true });
});

export default router;
