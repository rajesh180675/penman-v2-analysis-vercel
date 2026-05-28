/* ================================================================
   Plan 9 PR-9.3 — Backup scheduler + retention policy.

   Production data lives in two stores:
     1. Vercel KV (audit runs, comparison registries, residuals,
        annotations) — durable but no point-in-time recovery on the
        Hobby plan.
     2. Vercel Blob (large envelopes, locked evidence) — durable
        but no automatic snapshots.

   This module ships pure logic for:
     - shouldSnapshotNow(lastBackupAt, now, frequency) -> boolean
     - retentionWindow(now, retentionDays) -> { cutoff, keepCount }
     - snapshotKey(now, scope) -> stable storage key

   The actual snapshot worker (cron-triggered Vercel function that
   walks KV scopes and writes to Blob) is a follow-up. Shipping the
   pure scheduler first means the worker is a thin shell — testable
   logic stays in this module.

   Frequency policy:
     - audit-runs:           daily at 03:00 UTC, retain 90 days
     - comparison-registries: daily, retain 90 days
     - locked-evidence:      hourly, retain forever (legal record)
     - event-log:            hourly, retain 7 years (compliance)

   Drill schedule:
     - Quarterly restore drill — runbook is BACKUP_RUNBOOK.md
================================================================ */

export type BackupScope =
  | "audit-runs"
  | "comparison-registries"
  | "residuals"
  | "annotations"
  | "locked-evidence"
  | "event-log";

export type BackupFrequency = "hourly" | "daily" | "weekly";

export interface BackupPolicy {
  scope: BackupScope;
  frequency: BackupFrequency;
  retentionDays: number | "forever";
}

export const POLICIES: BackupPolicy[] = [
  { scope: "audit-runs", frequency: "daily", retentionDays: 90 },
  { scope: "comparison-registries", frequency: "daily", retentionDays: 90 },
  { scope: "residuals", frequency: "daily", retentionDays: 90 },
  { scope: "annotations", frequency: "daily", retentionDays: 365 },
  { scope: "locked-evidence", frequency: "hourly", retentionDays: "forever" },
  { scope: "event-log", frequency: "hourly", retentionDays: 7 * 365 },
];

const FREQ_MS: Record<BackupFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Returns true when a new snapshot should be taken given the last
 * backup timestamp and the desired frequency.
 *
 * Genesis case: lastBackupAt === null -> always snapshot.
 */
export function shouldSnapshotNow(
  lastBackupAt: Date | null,
  now: Date,
  frequency: BackupFrequency,
): boolean {
  if (lastBackupAt === null) return true;
  const elapsed = now.getTime() - lastBackupAt.getTime();
  return elapsed >= FREQ_MS[frequency];
}

export interface RetentionWindow {
  cutoff: Date;
  retainForever: boolean;
}

/** Compute the cutoff timestamp before which snapshots should be pruned. */
export function retentionWindow(
  now: Date,
  retentionDays: number | "forever",
): RetentionWindow {
  if (retentionDays === "forever") {
    return { cutoff: new Date(0), retainForever: true };
  }
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return { cutoff: new Date(cutoffMs), retainForever: false };
}

/**
 * Stable, sortable key for a snapshot. Lexicographic order matches
 * chronological order so a directory listing is already sorted.
 *
 * Format: "snapshots/<scope>/<YYYY-MM-DDTHH-mm-ss>.json"
 */
export function snapshotKey(now: Date, scope: BackupScope): string {
  // ISO without separators that confuse blob path parsers
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
  return `snapshots/${scope}/${stamp}.json`;
}

/** Filter a list of snapshot keys down to those still inside the retention window. */
export function withinRetention(
  keys: string[],
  policy: BackupPolicy,
  now: Date,
): string[] {
  const win = retentionWindow(now, policy.retentionDays);
  if (win.retainForever) return keys;

  return keys.filter((k) => {
    const stamp = extractTimestamp(k);
    if (!stamp) return true; // unparsable keys are kept
    return stamp.getTime() >= win.cutoff.getTime();
  });
}

function extractTimestamp(key: string): Date | null {
  // snapshots/<scope>/<ISO-with-dashes>.json
  const m = key.match(/snapshots\/[^/]+\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)\.json$/);
  if (!m) return null;
  // Convert YYYY-MM-DDTHH-MM-SS-mmmZ back to YYYY-MM-DDTHH:MM:SS.mmmZ
  const iso = m[1]!.replace(/(\d{2})-(\d{2})-(\d{2})-(\d+)Z/, "$1:$2:$3.$4Z");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
