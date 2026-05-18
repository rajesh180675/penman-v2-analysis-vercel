import { Router, Request, Response } from "express";
import { readJson, writeJson, listFiles, researchPath, researchDir } from "../store/fsStore";

const router = Router();

// GET /api/research — list all workspace entries
router.get("/", async (_req: Request, res: Response) => {
  const dir = researchDir();
  const files = await listFiles(dir);
  const entries = await Promise.all(files.map(f => readJson(f)));
  return res.json({ ok: true, entries: entries.filter(Boolean) });
});

// GET /api/research/:companyId — get workspace for a company
router.get("/:companyId", async (req: Request, res: Response) => {
  const data = await readJson(researchPath(req.params.companyId));
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true, data });
});

// PUT /api/research/:companyId — upsert workspace for a company
router.put("/:companyId", async (req: Request, res: Response) => {
  const companyId = req.params.companyId;
  const existing = await readJson<any>(researchPath(companyId)) ?? {};
  const merged = { ...existing, ...req.body, companyId, updatedAt: new Date().toISOString() };
  await writeJson(researchPath(companyId), merged);
  return res.json({ ok: true, data: merged });
});

// DELETE /api/research/:companyId — delete workspace
router.delete("/:companyId", async (req: Request, res: Response) => {
  const { deleteFile: del } = await import("../store/fsStore");
  await del(researchPath(req.params.companyId));
  return res.json({ ok: true });
});

export default router;
