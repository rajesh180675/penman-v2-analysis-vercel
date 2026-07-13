export interface PlatformSqlMigration {
  readonly id: string;
  readonly description: string;
  readonly statements: readonly string[];
  readonly rollbackStatements: readonly string[];
}

/** PostgreSQL-compatible metadata schema. Immutable artifact bytes remain in
 * object storage; only indexed metadata and references live in SQL.
 */
export const PLATFORM_SQL_MIGRATIONS: readonly PlatformSqlMigration[] = Object.freeze([
  {
    id: "20260712_001_platform_core",
    description: "Workspace-scoped runs, idempotency, artifacts, events, locks, memberships, and rate limits.",
    statements: [
      `create table if not exists platform_schema_migrations (
        migration_id text primary key, checksum text not null, applied_at timestamptz not null
      )`,
      `create table if not exists platform_analysis_runs (
        organization_id text not null, workspace_id text not null, run_id text not null,
        issuer_id text not null, lifecycle text not null check (lifecycle in ('open','finalized')),
        status text not null, as_of date not null, created_at timestamptz not null,
        reproducibility_hash text not null, revision integer not null check (revision > 0),
        run_json jsonb not null, primary key (organization_id, workspace_id, run_id)
      )`,
      `create index if not exists platform_runs_query_idx on platform_analysis_runs
        (organization_id, workspace_id, created_at desc, run_id)`,
      `create table if not exists platform_idempotency_receipts (
        organization_id text not null, workspace_id text not null, idempotency_key text not null,
        operation text not null, request_fingerprint text not null, resource_id text not null,
        created_at timestamptz not null default now(), primary key (organization_id, workspace_id, idempotency_key)
      )`,
      `create table if not exists platform_artifacts (
        organization_id text not null, workspace_id text not null, content_hash text not null,
        kind text not null, schema_version text not null, media_type text not null, byte_length bigint not null,
        object_key text not null, content_class text not null, issuer_id text null,
        created_at timestamptz not null, retention_until timestamptz null,
        primary key (organization_id, workspace_id, content_hash, kind, schema_version, media_type)
      )`,
      `create index if not exists platform_artifact_retention_idx on platform_artifacts
        (organization_id, workspace_id, retention_until) where retention_until is not null`,
      `create table if not exists platform_run_events (
        organization_id text not null, workspace_id text not null, run_id text not null,
        sequence integer not null, event_id text not null, run_revision integer not null,
        event_type text not null, occurred_at timestamptz not null, correlation_id text not null,
        actor_principal_id text not null, previous_event_hash text null, event_hash text not null,
        payload_ref jsonb null, primary key (organization_id, workspace_id, run_id, sequence),
        unique (organization_id, workspace_id, event_id)
      )`,
      `create table if not exists platform_run_locks (
        organization_id text not null, workspace_id text not null, run_id text not null,
        lock_id text not null, run_revision integer not null, reason text not null,
        locked_at timestamptz not null, principal_id text not null, lock_revision integer not null,
        primary key (organization_id, workspace_id, run_id), unique (organization_id, workspace_id, lock_id)
      )`,
      `create table if not exists platform_workspace_memberships (
        organization_id text not null, workspace_id text not null, principal_id text not null,
        roles jsonb not null, status text not null, valid_from timestamptz not null, valid_until timestamptz null,
        primary key (organization_id, workspace_id, principal_id)
      )`,
      `create table if not exists platform_rate_limits (
        rate_key text primary key, count integer not null, reset_at timestamptz not null
      )`,
    ],
    rollbackStatements: [
      "drop table if exists platform_rate_limits",
      "drop table if exists platform_workspace_memberships",
      "drop table if exists platform_run_locks",
      "drop table if exists platform_run_events",
      "drop table if exists platform_artifacts",
      "drop table if exists platform_idempotency_receipts",
      "drop table if exists platform_analysis_runs",
    ],
  },
  {
    id: "20260712_002_vintages_and_backups",
    description: "Point-in-time vintage observations, calibration reports, and restore evidence.",
    statements: [
      `create table if not exists platform_vintage_observations (
        organization_id text not null, workspace_id text not null, observation_id text not null,
        issuer_id text not null, family text not null, regime text not null, horizon_years integer not null,
        forecast_as_of date not null, available_at timestamptz not null, realized_at date not null,
        scenario_key text not null, payload jsonb not null, source_refs jsonb not null,
        primary key (organization_id, workspace_id, observation_id)
      )`,
      `create index if not exists platform_vintage_lookup_idx on platform_vintage_observations
        (organization_id, workspace_id, family, regime, horizon_years, available_at)`,
      `create table if not exists platform_backup_manifests (
        organization_id text not null, workspace_id text not null, backup_id text not null,
        created_at timestamptz not null, schema_version text not null, manifest_hash text not null,
        object_key text not null, restored_at timestamptz null,
        primary key (organization_id, workspace_id, backup_id)
      )`,
    ],
    rollbackStatements: [
      "drop table if exists platform_backup_manifests",
      "drop table if exists platform_vintage_observations",
    ],
  },
  {
    id: "20260713_003_integrity_and_retention_holds",
    description: "Durable artifact holds and relational integrity for events and publication locks.",
    statements: [
      `create table if not exists platform_artifact_holds (
        organization_id text not null, workspace_id text not null, content_hash text not null,
        kind text not null, schema_version text not null, media_type text not null, hold_id text not null,
        created_at timestamptz not null default now(),
        primary key (organization_id, workspace_id, content_hash, kind, schema_version, media_type, hold_id),
        foreign key (organization_id, workspace_id, content_hash, kind, schema_version, media_type)
          references platform_artifacts (organization_id, workspace_id, content_hash, kind, schema_version, media_type)
          on delete restrict
      )`,
      `create index if not exists platform_artifact_holds_scope_idx on platform_artifact_holds
        (organization_id, workspace_id, hold_id)`,
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'platform_run_events_run_fk') then
          alter table platform_run_events add constraint platform_run_events_run_fk
            foreign key (organization_id, workspace_id, run_id)
            references platform_analysis_runs (organization_id, workspace_id, run_id) on delete restrict;
        end if;
      end $$`,
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'platform_run_locks_run_fk') then
          alter table platform_run_locks add constraint platform_run_locks_run_fk
            foreign key (organization_id, workspace_id, run_id)
            references platform_analysis_runs (organization_id, workspace_id, run_id) on delete restrict;
        end if;
      end $$`,
    ],
    rollbackStatements: [
      "alter table platform_run_locks drop constraint if exists platform_run_locks_run_fk",
      "alter table platform_run_events drop constraint if exists platform_run_events_run_fk",
      "drop table if exists platform_artifact_holds",
    ],
  },
  {
    id: "20260713_004_governance_evidence",
    description: "Workspace-scoped calibration reports, reviewed sector sidecars, promotion dossiers, and delivery outbox.",
    statements: [
      `alter table platform_vintage_observations add column if not exists payload_hash text null`,
      `update platform_vintage_observations set payload_hash = 'legacy-unverified:' || observation_id where payload_hash is null`,
      `alter table platform_vintage_observations alter column payload_hash set not null`,
      `create table if not exists platform_calibration_reports (
        organization_id text not null, workspace_id text not null, report_hash text not null,
        family text not null, regime text not null, horizon_years integer not null,
        calibration_as_of timestamptz not null, status text not null, report_json jsonb not null,
        created_at timestamptz not null, created_by text not null,
        primary key (organization_id, workspace_id, report_hash)
      )`,
      `create index if not exists platform_calibration_reports_lookup_idx on platform_calibration_reports
        (organization_id, workspace_id, family, regime, horizon_years, calibration_as_of desc)`,
      `create table if not exists platform_sector_sidecars (
        organization_id text not null, workspace_id text not null, sidecar_id text not null,
        issuer_id text not null, case_type text not null, reviewed_at timestamptz not null,
        reviewer_principal_id text not null, status text not null, payload_hash text not null,
        sidecar_json jsonb not null, created_at timestamptz not null default now(),
        primary key (organization_id, workspace_id, sidecar_id),
        unique (organization_id, workspace_id, payload_hash)
      )`,
      `create index if not exists platform_sector_sidecars_issuer_idx on platform_sector_sidecars
        (organization_id, workspace_id, issuer_id, reviewed_at desc)`,
      `create table if not exists platform_model_promotion_dossiers (
        organization_id text not null, workspace_id text not null, dossier_hash text not null,
        model_id text not null, dossier_json jsonb not null, submitted_at timestamptz not null,
        submitted_by text not null, primary key (organization_id, workspace_id, dossier_hash)
      )`,
      `create index if not exists platform_promotion_dossiers_model_idx on platform_model_promotion_dossiers
        (organization_id, workspace_id, model_id, submitted_at desc)`,
      `create table if not exists platform_model_promotion_reviews (
        organization_id text not null, workspace_id text not null, dossier_hash text not null,
        reviewer_principal_id text not null, decision text not null check (decision in ('approved','rejected')),
        evidence_ref text not null, reviewed_at timestamptz not null,
        primary key (organization_id, workspace_id, dossier_hash, reviewer_principal_id),
        foreign key (organization_id, workspace_id, dossier_hash)
          references platform_model_promotion_dossiers (organization_id, workspace_id, dossier_hash) on delete restrict
      )`,
      `create table if not exists platform_membership_events (
        organization_id text not null, workspace_id text not null, event_id text not null,
        target_principal_id text not null, actor_principal_id text not null, occurred_at timestamptz not null,
        previous_membership jsonb null, next_membership jsonb not null,
        primary key (organization_id, workspace_id, event_id)
      )`,
      `create table if not exists platform_outbox (
        organization_id text not null, workspace_id text not null, message_id text not null,
        topic text not null, aggregate_id text not null, payload_json jsonb not null,
        created_at timestamptz not null default now(), delivered_at timestamptz null,
        attempt_count integer not null default 0, last_error text null,
        available_at timestamptz not null default now(), locked_at timestamptz null, locked_by text null,
        primary key (organization_id, workspace_id, message_id)
      )`,
      `create index if not exists platform_outbox_pending_idx on platform_outbox (created_at)
        where delivered_at is null`,
    ],
    rollbackStatements: [
      "drop table if exists platform_outbox",
      "drop table if exists platform_model_promotion_reviews",
      "drop table if exists platform_membership_events",
      "drop table if exists platform_model_promotion_dossiers",
      "drop table if exists platform_sector_sidecars",
      "drop table if exists platform_calibration_reports",
      "alter table platform_vintage_observations drop column if exists payload_hash",
    ],
  },
  {
    id: "20260713_005_real_options_composition",
    description: "Independently reviewed anti-double-counting dossiers for real-options composition candidates.",
    statements: [
      `create table if not exists platform_model_composition_dossiers (
        organization_id text not null, workspace_id text not null, dossier_hash text not null,
        model_id text not null, issuer_id text not null, sidecar_id text not null,
        effective_as_of date not null, base_model_id text not null, dossier_json jsonb not null,
        submitted_at timestamptz not null, submitted_by text not null,
        primary key (organization_id, workspace_id, dossier_hash)
      )`,
      `create index if not exists platform_model_composition_lookup_idx on platform_model_composition_dossiers
        (organization_id, workspace_id, issuer_id, sidecar_id, submitted_at desc)`,
      `create table if not exists platform_model_composition_reviews (
        organization_id text not null, workspace_id text not null, dossier_hash text not null,
        reviewer_principal_id text not null, decision text not null check (decision in ('approved','rejected')),
        evidence_ref text not null, reviewed_at timestamptz not null,
        primary key (organization_id, workspace_id, dossier_hash, reviewer_principal_id),
        foreign key (organization_id, workspace_id, dossier_hash)
          references platform_model_composition_dossiers (organization_id, workspace_id, dossier_hash) on delete restrict
      )`,
    ],
    rollbackStatements: [
      "drop table if exists platform_model_composition_reviews",
      "drop table if exists platform_model_composition_dossiers",
    ],
  },
]);

export async function applyPlatformMigrations(input: {
  readonly driver: { transaction<T>(operation: (tx: { query(text: string, parameters?: readonly unknown[]): Promise<unknown> }) => Promise<T>): Promise<T> };
  readonly alreadyApplied: ReadonlySet<string>;
}): Promise<readonly string[]> {
  const applied: string[] = [];
  await input.driver.transaction(async (transaction) => {
    await transaction.query("select pg_advisory_xact_lock(hashtext('penman-platform-migrations'))");
    await transaction.query("create table if not exists platform_schema_migrations (migration_id text primary key, checksum text null, applied_at timestamptz not null)");
    await transaction.query("alter table platform_schema_migrations add column if not exists checksum text null");
    await transaction.query("update platform_schema_migrations set checksum = 'legacy-unverified' where checksum is null");
    await transaction.query("alter table platform_schema_migrations alter column checksum set not null");
  });
  for (const migration of PLATFORM_SQL_MIGRATIONS) {
    if (input.alreadyApplied.has(migration.id)) continue;
    await input.driver.transaction(async (transaction) => {
      await transaction.query("select pg_advisory_xact_lock(hashtext('penman-platform-migrations'))");
      for (const statement of migration.statements) await transaction.query(statement);
      const checksum = await migrationChecksum(migration);
      await transaction.query("insert into platform_schema_migrations (migration_id, checksum, applied_at) values ($1, $2, now()) on conflict (migration_id) do nothing", [migration.id, checksum]);
    });
    applied.push(migration.id);
  }
  return Object.freeze(applied);
}

export async function migrationChecksum(migration: PlatformSqlMigration): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ id: migration.id, description: migration.description, statements: migration.statements }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function inspectPlatformMigrationState(driver: { query<TRow extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<{ readonly rows: readonly TRow[] }> }): Promise<{
  readonly appliedIds: ReadonlySet<string>; readonly pendingIds: readonly string[]; readonly checksumMismatchIds: readonly string[];
}> {
  let rows: readonly ({ migration_id: string; checksum: string } & Record<string, unknown>)[] = [];
  try { rows = (await driver.query<{ migration_id: string; checksum: string } & Record<string, unknown>>("select migration_id, checksum from platform_schema_migrations order by migration_id")).rows; } catch { /* An absent ledger means every migration is pending. */ }
  const byId = new Map(rows.map((row) => [row.migration_id, row.checksum]));
  const pendingIds = PLATFORM_SQL_MIGRATIONS.map((migration) => migration.id).filter((id) => !byId.has(id));
  const checksumMismatchIds: string[] = [];
  for (const migration of PLATFORM_SQL_MIGRATIONS) {
    const stored = byId.get(migration.id);
    if (stored !== undefined && stored !== await migrationChecksum(migration)) checksumMismatchIds.push(migration.id);
  }
  return Object.freeze({ appliedIds: new Set(byId.keys()), pendingIds: Object.freeze(pendingIds), checksumMismatchIds: Object.freeze(checksumMismatchIds) });
}
