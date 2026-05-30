/**
 * Residuals Store — Gap 7 / PR-G.
 *
 * Persisted per-company history of residual summaries (one per run).
 * Lives in localStorage with `penman.residuals.<companyId>.v1` keys —
 * one key per company so individual writes stay small.
 *
 * Caps:
 *   - 100 entries per company (drop oldest on overflow)
 *   - 5MB total across all companies (drop oldest entry across all
 *     companies until under cap on overflow)
 *
 * The store catches localStorage failures (quota exceeded, unavailable)
 * and returns gracefully — telemetry is best-effort.
 */

const COMPANY_KEY_PREFIX = "penman.residuals.";
const COMPANY_KEY_SUFFIX = ".v1";
const PER_COMPANY_CAP = 100;
const GLOBAL_BYTES_CAP = 5 * 1024 * 1024;

export interface RunResidualSummary {
  runId: string;
  timestamp: string;
  companyId: string;
  schemaVersion: string;
  parserResiduals: {
    unresolvableRowCount: number;
    numericParseErrorCount: number;
    blankRowRate: number;
  };
  mappingResiduals: {
    unresolvedCriticalCount: number;
    unresolvedSupportingCount: number;
    conflictCount: number;
  };
  identityResiduals: {
    maxResidualRatio: number;
    failedCheckCount: number;
  };
  valuationBridgeResiduals: {
    intrinsicValueSensitivity: number;
    terminalValueShare: number;
  };
  /** 0-100; lower is better. */
  overallResidualScore: number;
}

/** Threshold above which a run cannot reach `production-ready`. */
export const RESIDUAL_SCORE_PRODUCTION_THRESHOLD = 40;

function companyKey(companyId: string): string {
  return `${COMPANY_KEY_PREFIX}${companyId}${COMPANY_KEY_SUFFIX}`;
}

function readCompanyEntries(companyId: string): RunResidualSummary[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(companyKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function isValid(value: unknown): value is RunResidualSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.companyId === "string" &&
    typeof v.overallResidualScore === "number"
  );
}

function getStoreSizeBytesInternal(): number {
  let total = 0;
  try {
    if (typeof localStorage === "undefined") return 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(COMPANY_KEY_PREFIX) && key.endsWith(COMPANY_KEY_SUFFIX)) {
        total += (localStorage.getItem(key) ?? "").length;
      }
    }
  } catch {
    return total;
  }
  return total;
}

function listCompanyKeys(): string[] {
  const keys: string[] = [];
  try {
    if (typeof localStorage === "undefined") return [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(COMPANY_KEY_PREFIX) && key.endsWith(COMPANY_KEY_SUFFIX)) {
        keys.push(key);
      }
    }
  } catch {
    return keys;
  }
  return keys;
}

/**
 * Append a residual summary to a company's history. Enforces per-company
 * cap (drop oldest) and global byte cap (drop oldest entry across all
 * companies until under cap).
 */
export function appendRunResidualSummary(s: RunResidualSummary): void {
  if (typeof localStorage === "undefined") return;
  try {
    const existing = readCompanyEntries(s.companyId);
    const next = [...existing, s];
    const trimmed = next.length > PER_COMPANY_CAP ? next.slice(-PER_COMPANY_CAP) : next;
    localStorage.setItem(companyKey(s.companyId), JSON.stringify(trimmed));

    // Global cap: if we've blown 5MB, evict oldest-globally until under.
    while (getStoreSizeBytesInternal() > GLOBAL_BYTES_CAP) {
      if (!evictOldestGlobalEntry()) break;
    }
  } catch {
    // Quota exceeded, etc. — drop silently.
  }
}

function evictOldestGlobalEntry(): boolean {
  let oldestKey: string | null = null;
  let oldestTimestamp = "9999-99-99";
  let oldestEntries: RunResidualSummary[] = [];
  for (const key of listCompanyKeys()) {
    const id = key.slice(COMPANY_KEY_PREFIX.length, -COMPANY_KEY_SUFFIX.length);
    const entries = readCompanyEntries(id);
    if (entries.length === 0) continue;
    const first = entries[0]!;
    if (first.timestamp < oldestTimestamp) {
      oldestTimestamp = first.timestamp;
      oldestKey = key;
      oldestEntries = entries;
    }
  }
  if (!oldestKey) return false;
  try {
    const after = oldestEntries.slice(1);
    if (after.length === 0) {
      localStorage.removeItem(oldestKey);
    } else {
      localStorage.setItem(oldestKey, JSON.stringify(after));
    }
    return true;
  } catch {
    return false;
  }
}

/** Read history for a single company, newest last. */
export function readResidualHistory(companyId: string, limit?: number): RunResidualSummary[] {
  const entries = readCompanyEntries(companyId);
  if (limit && limit > 0 && entries.length > limit) {
    return entries.slice(-limit);
  }
  return entries;
}

export function getStoreSizeBytes(): number {
  return getStoreSizeBytesInternal();
}

/** Test-only utility. */
export function __resetResidualsStore(): void {
  try {
    if (typeof localStorage === "undefined") return;
    for (const key of listCompanyKeys()) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
