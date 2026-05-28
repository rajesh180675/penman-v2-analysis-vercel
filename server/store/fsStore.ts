import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".penman-data");

export function dataDir(): string {
  return process.env.PENMAN_DATA_DIR || DEFAULT_DATA_DIR;
}

/** Ensure a directory exists. */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Read a JSON file, return null if not found. */
export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Write a JSON file (creates parent dirs). */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Delete a file (no error if missing). */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}

/** List files in a directory matching a pattern. Returns full paths. */
export async function listFiles(dir: string, extension = ".json"): Promise<string[]> {
  try {
    await ensureDir(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith(extension))
      .map(e => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Write raw binary data (for ZIP uploads). */
export async function writeBuffer(filePath: string, buffer: Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, buffer);
}

// ─── Path helpers ────────────────────────────────────────────────────────────

export function auditRunPath(runId: string): string {
  return path.join(dataDir(), "audit", "runs", `${runId}.json`);
}

export function auditEventDir(runId: string): string {
  return path.join(dataDir(), "audit", "events", runId);
}

export function auditEventPath(runId: string, eventId: string): string {
  return path.join(dataDir(), "audit", "events", runId, `${eventId}.json`);
}

export function auditUploadPath(runId: string, filename: string): string {
  return path.join(dataDir(), "audit", "uploads", runId, filename);
}

export function researchPath(companyId: string): string {
  return path.join(dataDir(), "research", "workspaces", `${companyId}.json`);
}

export function marketCachePath(symbol: string, date: string): string {
  return path.join(dataDir(), "market-cache", `${symbol}-${date}.json`);
}

export function runsDir(): string {
  return path.join(dataDir(), "audit", "runs");
}

export function researchDir(): string {
  return path.join(dataDir(), "research", "workspaces");
}

export const DATA_DIR = DEFAULT_DATA_DIR;
