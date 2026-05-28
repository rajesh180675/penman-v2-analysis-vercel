/* ================================================================
   Plan 6 PR-6.4 — Envelope migration runner.

   Walks stored AnalysisTraceabilityEnvelope payloads through
   schema upgrades. The chain currently spans v8 -> v16 with no
   destructive transforms — all upgrades are non-destructive
   (additive fields with safe defaults).

   When a migration runs, the envelope is stamped with
   `status: "synthetic-clean"` so reviewers can spot migrated runs
   in the UI and re-run them from source data when defensibility
   matters more than convenience.

   Why ship migrations instead of rejecting old envelopes:
     - Old companyRegistry payloads in localStorage / KV would
       become unreadable on schema bumps.
     - The registry sanitizer already drops mismatched envelopes,
       which causes silent data loss for users who haven't refreshed.
     - With migrations, reviewers see migrated cells with a sentinel
       and can opt-in to re-running rather than losing context.

   PR-6.4 ships the runner + tests. Wiring into the registry
   sanitizer (so loadComparisonRegistry calls migrateEnvelope before
   comparing schemaVersion) is a follow-up.
================================================================ */

export const KNOWN_SCHEMA_VERSIONS = [
  "2026-04-traceability-v8",
  "2026-05-traceability-v9",
  "2026-05-traceability-v10",
  "2026-05-traceability-v11",
  "2026-06-traceability-v12",
  "2026-06-traceability-v13",
  "2026-06-traceability-v14",
  "2026-06-traceability-v15",
  "2026-06-traceability-v16",
  "2026-06-traceability-v17",
] as const;

export const CURRENT_SCHEMA_VERSION = "2026-06-traceability-v17";

export interface MigrateResult {
  envelope: { schemaVersion: string; status?: string; [key: string]: unknown };
  migrationsApplied: string[];
  /** True when the input is unmigratable (unknown version or missing schemaVersion). */
  rejected: boolean;
}

/* ----------------- Per-version migrators ----------------------- */

type Migrator = (env: Record<string, unknown>) => Record<string, unknown>;

/**
 * Each migrator takes an envelope at version X and returns it at
 * version X+1. Migrators MUST be non-destructive — only add fields
 * with safe defaults. If a destructive transform becomes necessary,
 * the migration target should be a separate schema family
 * (e.g. v17 -> v17-destructive) so reviewers see the discontinuity.
 */
const MIGRATORS: Record<string, Migrator> = {
  "2026-04-traceability-v8": (env) => ({
    ...env,
    schemaVersion: "2026-05-traceability-v9",
    // v9 added analysisStatus envelope field
    analysisStatus: env.analysisStatus ?? null,
  }),
  "2026-05-traceability-v9": (env) => ({
    ...env,
    schemaVersion: "2026-05-traceability-v10",
    // v10 added retentionDays
    retentionDays: env.retentionDays ?? null,
  }),
  "2026-05-traceability-v10": (env) => ({
    ...env,
    schemaVersion: "2026-05-traceability-v11",
    // v11 added contentClass
    contentClass: env.contentClass ?? null,
  }),
  "2026-05-traceability-v11": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v12",
    // v12 added runInspectorEnabled flag
    runInspectorEnabled: env.runInspectorEnabled ?? false,
  }),
  "2026-06-traceability-v12": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v13",
    // v13 — no envelope-shape change (PR-1.4 added branded primitives types only)
  }),
  "2026-06-traceability-v13": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v14",
    // v14 added pipelineStrategyId (PR-3.5)
  }),
  "2026-06-traceability-v14": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v15",
    // v15 — SOTP support added (PR-5.4); no envelope-shape change
  }),
  "2026-06-traceability-v15": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v16",
    // v16 added FX-neutrality fields (PR-5b.5); safe-default to null
    fxNeutrality: env.fxNeutrality ?? null,
  }),
  "2026-06-traceability-v16": (env) => ({
    ...env,
    schemaVersion: "2026-06-traceability-v17",
    // v17 — evidence locking (PR-8.3); not-yet-locked envelopes default
    locked: env.locked ?? false,
  }),
};

/* ----------------- Public API ----------------------------------- */

export function migrateEnvelope(input: unknown): MigrateResult {
  if (
    typeof input !== "object" ||
    input == null ||
    typeof (input as { schemaVersion?: unknown }).schemaVersion !== "string"
  ) {
    return {
      envelope: input as MigrateResult["envelope"],
      migrationsApplied: [],
      rejected: true,
    };
  }

  let current: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const applied: string[] = [];

  // Walk forward through migrators until the current version has no migrator.
  while (true) {
    const version = current.schemaVersion;
    if (typeof version !== "string") break;
    if (version === CURRENT_SCHEMA_VERSION) break;

    if (!KNOWN_SCHEMA_VERSIONS.includes(version as typeof KNOWN_SCHEMA_VERSIONS[number])) {
      // Unknown ancestor — reject without partial migration.
      return {
        envelope: current as MigrateResult["envelope"],
        migrationsApplied: applied,
        rejected: true,
      };
    }

    const migrator = MIGRATORS[version];
    if (!migrator) break;

    applied.push(version);
    current = migrator(current);
  }

  // Stamp synthetic-clean if any migration ran
  if (applied.length > 0) {
    current = { ...current, status: "synthetic-clean" };
  }

  return {
    envelope: current as MigrateResult["envelope"],
    migrationsApplied: applied,
    rejected: false,
  };
}

/** How many migrations would run for a given starting version. */
export function listMigrationsApplied(fromVersion: string): number {
  if (!KNOWN_SCHEMA_VERSIONS.includes(fromVersion as typeof KNOWN_SCHEMA_VERSIONS[number])) {
    return 0;
  }
  let count = 0;
  let current = fromVersion;
  while (current !== CURRENT_SCHEMA_VERSION && MIGRATORS[current]) {
    count++;
    const next = MIGRATORS[current]!({ schemaVersion: current });
    current = next.schemaVersion as string;
  }
  return count;
}
