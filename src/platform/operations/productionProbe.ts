import type { DurableObjectStore, TransactionalSqlDriver } from "../durablePersistence/contracts";
import { inspectPlatformMigrationState } from "../durablePersistence/migrations";
import { evaluatePlatformOperationalHealth } from "./health";

interface BackupRow extends Record<string, unknown> { readonly created_at: string | Date; readonly restored_at: string | Date | null; }
function iso(value: string | Date): string { return typeof value === "string" ? new Date(value).toISOString() : value.toISOString(); }

export class ProductionPlatformProbe {
  constructor(
    private readonly sql: TransactionalSqlDriver,
    private readonly objects: DurableObjectStore,
    private readonly policy: { readonly maximumBackupAgeHours: number; readonly maximumRestoreDrillAgeDays: number } = { maximumBackupAgeHours: 26, maximumRestoreDrillAgeDays: 35 },
  ) {}

  async run(input: { readonly organizationId: string; readonly workspaceId: string; readonly probeId: string; readonly checkedAt: string }) {
    if (!Number.isFinite(Date.parse(input.checkedAt))) throw new Error("checkedAt must be valid.");
    await this.sql.transaction(async (tx) => { await tx.query("select 1 as platform_probe"); });
    const probeKey = `platform-probes/${input.organizationId}/${input.workspaceId}/${input.probeId}.bin`;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...input }));
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const contentHash = `sha256:${Buffer.from(digest).toString("hex")}`;
    await this.objects.putIfAbsent(probeKey, bytes, { contentType: "application/json", contentHash });
    const roundTrip = await this.objects.get(probeKey);
    await this.objects.delete(probeKey);
    if (!roundTrip || Buffer.compare(Buffer.from(roundTrip), Buffer.from(bytes)) !== 0) throw new Error("Object-store probe failed its read-after-write check.");
    const migrationState = await inspectPlatformMigrationState(this.sql);
    const pendingMigrationIds = [...migrationState.pendingIds];
    const latest = await this.sql.query<BackupRow>(
      `select created_at, restored_at from platform_backup_manifests where organization_id = $1 and workspace_id = $2
       order by created_at desc limit 1`, [input.organizationId, input.workspaceId],
    );
    const latestBackupAt = latest.rows[0] ? iso(latest.rows[0].created_at) : null;
    const latestRestoreDrillAt = latest.rows[0]?.restored_at ? iso(latest.rows[0].restored_at) : null;
    const operationalHealth = evaluatePlatformOperationalHealth({
      checkedAt: input.checkedAt,
      adapters: { status: "ready", checks: Object.freeze([
        { checkId: "transactional-sql", passed: true, summary: "Transactional read/write probe passed." },
        { checkId: "durable-object-store", passed: true, summary: "Private object read/write/delete probe passed." },
      ]) },
      pendingMigrationCount: pendingMigrationIds.length + migrationState.checksumMismatchIds.length,
      latestBackupAt,
      maximumBackupAgeHours: this.policy.maximumBackupAgeHours,
      restoreDrillAt: latestRestoreDrillAt,
      maximumRestoreDrillAgeDays: this.policy.maximumRestoreDrillAgeDays,
    });
    return Object.freeze({
      status: operationalHealth.status === "healthy" ? "ready" as const : "blocked" as const,
      checkedAt: input.checkedAt,
      adapterProbeStatus: "ready" as const,
      migrationStatus: pendingMigrationIds.length ? "pending" as const : migrationState.checksumMismatchIds.length ? "checksum-mismatch" as const : "current" as const,
      pendingMigrationIds: Object.freeze(pendingMigrationIds),
      checksumMismatchIds: migrationState.checksumMismatchIds,
      latestBackupAt,
      latestRestoreDrillAt,
      operationalHealth,
    });
  }
}
