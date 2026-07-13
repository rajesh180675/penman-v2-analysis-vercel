import * as path from "node:path";
import {
  auditBlobDir,
  auditKindRoot,
  auditRunPath,
  listDirectories,
  listDirectoryFiles,
  pathModifiedAt,
  readJson,
  removePath,
  runsDir,
} from "./fsStore";

const DAY_MS = 24 * 60 * 60 * 1_000;
let lastCleanupAt = 0;
let lastCleanupReport: AuditCleanupReport | null = null;

export interface AuditCleanupReport {
  expiredRuns: string[];
  expiredArtifacts: string[];
  orphanedDirectories: string[];
  checkedAt: string;
}

function elapsedDays(now: number, value: string | null | undefined): number {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? (now - timestamp) / DAY_MS : 0;
}

async function cleanupArtifactFiles(
  runId: string,
  now: number,
  defaultRetentionDays: number,
  report: AuditCleanupReport,
) {
  const dir = auditBlobDir(runId, "artifacts");
  const files = (await listDirectoryFiles(dir)).filter((file) => !file.endsWith(".meta.json"));
  for (const file of files) {
    const meta = await readJson<{ uploadedAt?: string; retentionDays?: number }>(`${file}.meta.json`);
    const uploadedAt = meta?.uploadedAt ?? await pathModifiedAt(file);
    const retentionDays = Number.isFinite(meta?.retentionDays) ? Number(meta?.retentionDays) : defaultRetentionDays;
    if (elapsedDays(now, uploadedAt) <= retentionDays) continue;
    await removePath(file);
    await removePath(`${file}.meta.json`);
    report.expiredArtifacts.push(`audit/artifacts/${runId}/${path.basename(file)}`);
  }
}

export async function cleanupLocalAuditStorage(options: {
  now?: Date;
  defaultRetentionDays?: number;
  orphanGraceDays?: number;
} = {}): Promise<AuditCleanupReport> {
  const nowDate = options.now ?? new Date();
  const now = nowDate.getTime();
  const defaultRetentionDays = options.defaultRetentionDays ?? 45;
  const orphanGraceDays = options.orphanGraceDays ?? 1;
  const report: AuditCleanupReport = {
    expiredRuns: [],
    expiredArtifacts: [],
    orphanedDirectories: [],
    checkedAt: nowDate.toISOString(),
  };

  const runFiles = await listDirectoryFiles(runsDir());
  const knownRuns = new Set(runFiles.filter((file) => file.endsWith(".json")).map((file) => path.basename(file, ".json")));
  for (const runId of knownRuns) {
    const run = await readJson<{ lastEventAt?: string; startedAt?: string; retentionDays?: number }>(auditRunPath(runId));
    const retentionDays = Number.isFinite(run?.retentionDays) ? Number(run?.retentionDays) : defaultRetentionDays;
    const referenceAt = run?.lastEventAt ?? run?.startedAt ?? await pathModifiedAt(auditRunPath(runId));
    if (elapsedDays(now, referenceAt) > retentionDays) {
      await removePath(auditRunPath(runId));
      for (const kind of ["events", "inputs", "artifacts", "uploads"] as const) {
        await removePath(path.join(auditKindRoot(kind), runId));
      }
      report.expiredRuns.push(runId);
      continue;
    }
    await cleanupArtifactFiles(runId, now, retentionDays, report);
  }

  for (const kind of ["events", "inputs", "artifacts", "uploads"] as const) {
    for (const dir of await listDirectories(auditKindRoot(kind))) {
      const runId = path.basename(dir);
      if (knownRuns.has(runId) || report.expiredRuns.includes(runId)) continue;
      const modifiedAt = await pathModifiedAt(dir);
      if (elapsedDays(now, modifiedAt) <= orphanGraceDays) continue;
      await removePath(dir);
      report.orphanedDirectories.push(`audit/${kind}/${runId}`);
    }
  }

  lastCleanupReport = report;
  return report;
}

export async function maybeCleanupLocalAuditStorage(): Promise<AuditCleanupReport | null> {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1_000) return null;
  lastCleanupAt = now;
  return cleanupLocalAuditStorage();
}

export function getLastLocalAuditCleanupReport(): AuditCleanupReport | null {
  return lastCleanupReport;
}
