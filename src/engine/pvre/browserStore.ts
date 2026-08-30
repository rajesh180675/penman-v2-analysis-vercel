/**
 * PVRE — browser-side snapshot persistence.
 *
 * The web app cannot write to disk. Instead, it stores a compact snapshot per
 * (ticker, run) in `localStorage` under a deterministic key. Over successive
 * analyses this builds the cross-vintage corpus `scorePvreCalibration` reads.
 *
 * Storage shape:
 *   "penman.pvre.v1.<ticker>" -> JSON array of PvreBrowserSnapshot, capped at
 *   the last 24 entries per ticker (ring buffer).
 */
import type { PvreOutput } from "./types";

export interface PvreBrowserSnapshot {
  readonly schemaVersion: "2026-08-pvre-snapshot-v1";
  readonly takenAt: string; // ISO date
  readonly ticker: string;
  readonly seed: number;
  readonly iterations: number;
  readonly marketPrice: number | null;
  readonly intrinsicQ05: number | null;
  readonly intrinsicQ50: number | null;
  readonly intrinsicQ95: number | null;
  readonly disagreementGate: "pass" | "guarded" | "blocked" | null;
  readonly dispersionRatio: number | null;
  readonly probabilityUndervalued: number | null;
}

const KEY_PREFIX = "penman.pvre.v1.";
const MAX_SNAPSHOTS_PER_TICKER = 24;

function storageKey(ticker: string): string {
  return `${KEY_PREFIX}${ticker.toLowerCase()}`;
}

function safeParse(raw: string | null): PvreBrowserSnapshot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object" && item.schemaVersion === "2026-08-pvre-snapshot-v1");
  } catch {
    return [];
  }
}

export function buildBrowserSnapshot(
  output: PvreOutput,
  meta: { ticker: string; asOf?: string },
): PvreBrowserSnapshot {
  return {
    schemaVersion: "2026-08-pvre-snapshot-v1",
    takenAt: meta.asOf ?? new Date().toISOString().slice(0, 10),
    ticker: meta.ticker,
    seed: output.seed,
    iterations: output.iterations,
    marketPrice: output.referencePrice,
    intrinsicQ05: output.intrinsic?.q05 ?? null,
    intrinsicQ50: output.intrinsic?.q50 ?? null,
    intrinsicQ95: output.intrinsic?.q95 ?? null,
    disagreementGate: output.disagreement?.gate ?? null,
    dispersionRatio: output.disagreement?.dispersionRatio ?? null,
    probabilityUndervalued: output.probabilityUndervalued,
  };
}

export function persistBrowserSnapshot(s: PvreBrowserSnapshot): void {
  try {
    const key = storageKey(s.ticker);
    const existing = safeParse(localStorage.getItem(key));
    // de-dupe identical (takenAt, seed, iterations) — the caller re-running
    // should not double-persist.
    const deduped = existing.filter(
      (e) => !(e.takenAt === s.takenAt && e.seed === s.seed && e.iterations === s.iterations),
    );
    const next = [...deduped, s].slice(-MAX_SNAPSHOTS_PER_TICKER);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // localStorage might be unavailable (SSR, private mode); storage is optional
  }
}

export function listBrowserSnapshots(ticker: string): PvreBrowserSnapshot[] {
  return safeParse(localStorage.getItem(storageKey(ticker)));
}
