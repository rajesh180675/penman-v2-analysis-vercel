import type { ProductionAdapterReadiness } from "../durablePersistence";

export interface PlatformOperationalHealth {
  readonly status: "healthy" | "degraded" | "critical";
  readonly checkedAt: string;
  readonly findings: readonly string[];
  readonly alerts: readonly { readonly severity: "warning" | "critical"; readonly code: string; readonly summary: string }[];
}

export function evaluatePlatformOperationalHealth(input: {
  readonly checkedAt: string;
  readonly adapters: ProductionAdapterReadiness;
  readonly pendingMigrationCount: number;
  readonly latestBackupAt: string | null;
  readonly maximumBackupAgeHours: number;
  readonly restoreDrillAt: string | null;
  readonly maximumRestoreDrillAgeDays: number;
}): PlatformOperationalHealth {
  const findings: string[] = [];
  const alerts: Array<{ severity: "warning" | "critical"; code: string; summary: string }> = [];
  const now = Date.parse(input.checkedAt);
  const backupAt = input.latestBackupAt ? Date.parse(input.latestBackupAt) : Number.NaN;
  const drillAt = input.restoreDrillAt ? Date.parse(input.restoreDrillAt) : Number.NaN;
  if (!Number.isFinite(now)) alerts.push({ severity: "critical", code: "HEALTH_CLOCK_INVALID", summary: "Health check timestamp is invalid." });
  if (!Number.isInteger(input.pendingMigrationCount) || input.pendingMigrationCount < 0) alerts.push({ severity: "critical", code: "MIGRATION_COUNT_INVALID", summary: "Pending migration count is invalid." });
  if (!(Number.isFinite(input.maximumBackupAgeHours) && input.maximumBackupAgeHours > 0)) alerts.push({ severity: "critical", code: "BACKUP_POLICY_INVALID", summary: "Maximum backup age must be positive." });
  if (!(Number.isFinite(input.maximumRestoreDrillAgeDays) && input.maximumRestoreDrillAgeDays > 0)) alerts.push({ severity: "critical", code: "RESTORE_POLICY_INVALID", summary: "Maximum restore-drill age must be positive." });
  if (input.adapters.status !== "ready") alerts.push({ severity: "critical", code: "PRODUCTION_ADAPTERS_BLOCKED", summary: "One or more durable production adapters are missing." });
  if (input.pendingMigrationCount > 0) alerts.push({ severity: "critical", code: "PENDING_SCHEMA_MIGRATIONS", summary: `${input.pendingMigrationCount} schema migration(s) are pending.` });
  const backupAgeHours = Number.isFinite(now) && Number.isFinite(backupAt) ? (now - backupAt) / 3_600_000 : Infinity;
  if (!Number.isFinite(backupAt) || backupAgeHours < 0 || backupAgeHours > input.maximumBackupAgeHours) alerts.push({ severity: "critical", code: "BACKUP_STALE", summary: "The latest verified backup is missing, invalid, future-dated, or exceeds the maximum age." });
  const drillAgeDays = Number.isFinite(now) && Number.isFinite(drillAt) ? (now - drillAt) / 86_400_000 : Infinity;
  if (!Number.isFinite(drillAt) || drillAgeDays < 0 || drillAgeDays > input.maximumRestoreDrillAgeDays) alerts.push({ severity: "warning", code: "RESTORE_DRILL_OVERDUE", summary: "Restore-drill evidence is missing, invalid, future-dated, or overdue." });
  if (!alerts.length) findings.push("Durable adapters, migrations, backup freshness, and restore-drill evidence are healthy.");
  return Object.freeze({
    status: alerts.some((alert) => alert.severity === "critical") ? "critical" : alerts.length ? "degraded" : "healthy",
    checkedAt: input.checkedAt,
    findings: Object.freeze(findings), alerts: Object.freeze(alerts),
  });
}
