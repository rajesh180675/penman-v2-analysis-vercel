import type { DurableObjectStore, TransactionalSqlDriver } from "../durablePersistence";
import { createBackupPackage, verifyAndRestoreBackup, type BackupAuthenticator, type BackupEntry, type BackupPackage } from "./backupRestore";

const WORKSPACE_TABLES = [
  "platform_analysis_runs", "platform_idempotency_receipts", "platform_artifacts", "platform_artifact_holds",
  "platform_run_events", "platform_run_locks", "platform_workspace_memberships", "platform_vintage_observations",
  "platform_calibration_reports", "platform_sector_sidecars", "platform_model_promotion_dossiers", "platform_outbox",
  "platform_model_promotion_reviews", "platform_membership_events", "platform_model_composition_dossiers",
  "platform_model_composition_reviews",
] as const;

interface ArtifactObjectRow extends Record<string, unknown> { readonly object_key: string; readonly media_type: string; }
interface BackupManifestRow extends Record<string, unknown> { readonly backup_id: string; readonly object_key: string; readonly created_at: string | Date; }

function serializeBackup(backup: BackupPackage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ manifest: backup.manifest, entries: backup.entries.map((entry) => ({ key: entry.key, mediaType: entry.mediaType, base64: Buffer.from(entry.bytes).toString("base64") })) }));
}

function deserializeBackup(bytes: Uint8Array): BackupPackage {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as { manifest: BackupPackage["manifest"]; entries: Array<{ key: string; mediaType: string; base64: string }> };
  return { manifest: value.manifest, entries: value.entries.map((entry) => ({ key: entry.key, mediaType: entry.mediaType, bytes: new Uint8Array(Buffer.from(entry.base64, "base64")) })) };
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

/** Creates authenticated workspace backups and exercises isolated object-store restore drills. */
export class ProductionBackupRestoreDrill {
  constructor(private readonly sql: TransactionalSqlDriver, private readonly objects: DurableObjectStore, private readonly authenticator: BackupAuthenticator) {}

  async createWorkspaceBackup(input: { readonly organizationId: string; readonly workspaceId: string; readonly backupId: string; readonly createdAt: string }): Promise<{ readonly objectKey: string; readonly package: BackupPackage }> {
    const entries: BackupEntry[] = [];
    for (const table of WORKSPACE_TABLES) {
      const result = await this.sql.query(`select * from ${table} where organization_id = $1 and workspace_id = $2`, [input.organizationId, input.workspaceId]);
      entries.push({ key: `metadata/${table}.json`, mediaType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(result.rows)) });
    }
    const artifacts = await this.sql.query<ArtifactObjectRow>("select object_key, media_type from platform_artifacts where organization_id = $1 and workspace_id = $2 order by object_key", [input.organizationId, input.workspaceId]);
    const objectIndex: Array<{ backupKey: string; objectKey: string; mediaType: string }> = [];
    for (const [index, artifact] of artifacts.rows.entries()) {
      const bytes = await this.objects.get(artifact.object_key);
      if (!bytes) throw new Error(`Backup blocked because artifact object ${index} is missing.`);
      const backupKey = `objects/${index.toString().padStart(8, "0")}.bin`;
      objectIndex.push({ backupKey, objectKey: artifact.object_key, mediaType: artifact.media_type });
      entries.push({ key: backupKey, mediaType: artifact.media_type, bytes });
    }
    entries.push({ key: "metadata/object-index.json", mediaType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(objectIndex)) });
    const backup = await createBackupPackage({ ...input, entries, authenticator: this.authenticator });
    const encoded = serializeBackup(backup);
    const objectKey = `platform-backups/${input.organizationId}/${input.workspaceId}/${input.backupId}.json`;
    await this.objects.putIfAbsent(objectKey, encoded, { contentType: "application/json", contentHash: await hash(encoded) });
    await this.sql.query(
      `insert into platform_backup_manifests (organization_id, workspace_id, backup_id, created_at, schema_version, manifest_hash, object_key)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (organization_id, workspace_id, backup_id) do nothing`,
      [input.organizationId, input.workspaceId, input.backupId, input.createdAt, backup.manifest.schemaVersion, backup.manifest.manifestHash, objectKey],
    );
    return { objectKey, package: backup };
  }

  async runLatestRestoreDrill(input: { readonly organizationId: string; readonly workspaceId: string; readonly drillId: string; readonly restoredAt: string }) {
    const latest = await this.sql.query<BackupManifestRow>(
      `select backup_id, object_key, created_at from platform_backup_manifests where organization_id = $1 and workspace_id = $2
       order by created_at desc limit 1`, [input.organizationId, input.workspaceId],
    );
    const row = latest.rows[0];
    if (!row) throw new Error("No workspace backup is available for a restore drill.");
    const encoded = await this.objects.get(row.object_key);
    if (!encoded) throw new Error("The latest backup package object is missing.");
    const backup = deserializeBackup(encoded);
    let staged: readonly BackupEntry[] = [];
    const verified = await verifyAndRestoreBackup(backup, { restoreAtomically: async (entries) => { staged = entries.map((entry) => ({ ...entry, bytes: new Uint8Array(entry.bytes) })); } }, this.authenticator);
    if (verified.status !== "restored") return verified;
    const drillPrefix = `platform-restore-drills/${input.organizationId}/${input.workspaceId}/${input.drillId}`;
    const written: string[] = [];
    const schemaSuffix = input.drillId.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    if (!schemaSuffix) throw new Error("Restore drill ID cannot form a safe schema name.");
    const restoreSchema = `platform_restore_${schemaSuffix}`;
    let schemaCreated = false;
    try {
      await this.sql.transaction(async (tx) => {
        await tx.query(`create schema "${restoreSchema}"`);
        schemaCreated = true;
        for (const table of WORKSPACE_TABLES) {
          const entry = staged.find((candidate) => candidate.key === `metadata/${table}.json`);
          if (!entry) throw new Error(`Restore drill metadata is missing ${table}.`);
          const rows = JSON.parse(new TextDecoder().decode(entry.bytes));
          if (!Array.isArray(rows)) throw new Error(`Restore drill metadata for ${table} is not an array.`);
          await tx.query(`create table "${restoreSchema}"."${table}" (like "${table}" including all)`);
          if (rows.length) await tx.query(`insert into "${restoreSchema}"."${table}" select * from json_populate_recordset(null::"${restoreSchema}"."${table}", $1::json)`, [JSON.stringify(rows)]);
          const count = await tx.query<{ count: number | string } & Record<string, unknown>>(`select count(*) as count from "${restoreSchema}"."${table}"`);
          if (Number(count.rows[0]?.count ?? -1) !== rows.length) throw new Error(`Restore drill row-count mismatch for ${table}.`);
        }
      });
      for (const entry of staged) {
        const key = `${drillPrefix}/${entry.key}`;
        await this.objects.putIfAbsent(key, entry.bytes, { contentType: entry.mediaType, contentHash: await hash(entry.bytes) });
        const roundTrip = await this.objects.get(key);
        if (!roundTrip || await hash(roundTrip) !== await hash(entry.bytes)) throw new Error(`Restore drill round-trip failed for ${entry.key}.`);
        written.push(key);
      }
      await this.sql.query(
        "update platform_backup_manifests set restored_at = $1 where organization_id = $2 and workspace_id = $3 and backup_id = $4",
        [input.restoredAt, input.organizationId, input.workspaceId, row.backup_id],
      );
      return { status: "restored" as const, restoredCount: staged.length, errors: [] as readonly string[] };
    } finally {
      await Promise.allSettled(written.map((key) => this.objects.delete(key)));
      if (schemaCreated) await this.sql.query(`drop schema if exists "${restoreSchema}" cascade`);
    }
  }
}
