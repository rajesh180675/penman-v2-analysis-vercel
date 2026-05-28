/**
 * Schema Migration Telemetry — observability for envelope schema bumps.
 *
 * When a sanitizer rejects a stale envelope (e.g. v8 in localStorage after
 * the app has bumped to v9), we want to:
 *   1. Log the event via traceLogger so it shows in the Debug panel
 *   2. Increment a counter in localStorage so ops can see migration volume
 *      across sessions
 *
 * The localStorage counter is capped at 100 entries (oldest evicted) so it
 * cannot grow unbounded. Each entry is small (~120 bytes), so the cap keeps
 * the store under 12KB.
 */

import { trace } from "./traceLogger";

export type MigrationSource = "envelope" | "registry" | "snapshot";

export interface MigrationContext {
  source: MigrationSource;
  companyId?: string | undefined;
}

export interface MigrationEntry {
  ts: string;
  from: string;
  to: string;
  source: MigrationSource;
  companyId?: string | undefined;
}

const STORAGE_KEY = "penman.schema-migrations.v1";
const MAX_ENTRIES = 100;

/**
 * Record a schema migration event. Idempotent and crash-safe — failures to
 * read/write localStorage do not throw.
 */
export function recordSchemaMigration(
  from: string,
  to: string,
  ctx: MigrationContext,
): void {
  const entry: MigrationEntry = {
    ts: new Date().toISOString(),
    from,
    to,
    source: ctx.source,
  };
  if (ctx.companyId) entry.companyId = ctx.companyId;

  trace("config", "schemaMigration", {
    from,
    to,
    source: ctx.source,
    companyId: ctx.companyId,
  });

  try {
    const existing = readEntries();
    const next = [...existing, entry];
    const trimmed =
      next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // localStorage unavailable or quota exceeded — telemetry is best-effort
  }
}

/**
 * Read the recorded migration entries. Used by DebugPanel to surface
 * migration volume.
 */
export function readSchemaMigrations(): MigrationEntry[] {
  return readEntries();
}

/**
 * Aggregate counts of recorded migrations, grouped by `from -> to`.
 */
export function summarizeSchemaMigrations(): {
  total: number;
  byVersion: Record<string, number>;
  bySource: Record<MigrationSource, number>;
} {
  const entries = readEntries();
  const byVersion: Record<string, number> = {};
  const bySource: Record<MigrationSource, number> = {
    envelope: 0,
    registry: 0,
    snapshot: 0,
  };
  for (const entry of entries) {
    const key = `${entry.from}->${entry.to}`;
    byVersion[key] = (byVersion[key] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
  }
  return { total: entries.length, byVersion, bySource };
}

/**
 * Clear migration entries. Test-only utility; not surfaced in UI.
 */
export function __resetSchemaMigrations(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function readEntries(): MigrationEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMigrationEntry);
  } catch {
    return [];
  }
}

function isMigrationEntry(value: unknown): value is MigrationEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ts === "string" &&
    typeof v.from === "string" &&
    typeof v.to === "string" &&
    (v.source === "envelope" || v.source === "registry" || v.source === "snapshot")
  );
}
