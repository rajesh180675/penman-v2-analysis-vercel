/**
 * PVRE persistence — Milestone C.
 *
 * Directory layout under <workspace>/.penman/pvre/<ticker>/:
 *   YYYY-MM-DD.seed-<seed>.itr-<N>.json       one snapshot per run
 *   latest.json                               copy of most recent snapshot
 *
 * A snapshot carries only the small summary required to backtest and
 * recalibrate later — NOT the full samples array, which grows quickly. The
 * full sampler can always be re-run from (seed, drivers) for detail.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { PvreOutput } from "../../src/engine/pvre/types";

export interface PvreSnapshot {
  readonly schemaVersion: "2026-08-pvre-snapshot-v1";
  readonly takenAt: string;
  readonly ticker: string | null;
  readonly seed: number;
  readonly iterations: number;
  readonly marketPrice: number | null;
  readonly intrinsic: PvreOutput["intrinsic"];
  readonly perModel: PvreOutput["perModel"];
  readonly disagreementGate: "pass" | "guarded" | "blocked" | null;
  readonly probabilityUndervalued: number | null;
}

export function buildSnapshot(
  output: PvreOutput,
  meta: { ticker: string | null; asOf?: string },
): PvreSnapshot {
  return {
    schemaVersion: "2026-08-pvre-snapshot-v1",
    takenAt: meta.asOf ?? new Date().toISOString().slice(0, 10),
    ticker: meta.ticker,
    seed: output.seed,
    iterations: output.iterations,
    marketPrice: output.referencePrice,
    intrinsic: output.intrinsic,
    perModel: output.perModel,
    disagreementGate: output.disagreement?.gate ?? null,
    probabilityUndervalued: output.probabilityUndervalued,
  };
}

export function snapshotFilename(s: PvreSnapshot): string {
  return `${s.takenAt}.seed-${s.seed}.itr-${s.iterations}.json`;
}

export function persistSnapshot(workspaceRoot: string, s: PvreSnapshot): string {
  const dir = join(workspaceRoot, ".penman", "pvre", (s.ticker ?? "unknown").toLowerCase());
  mkdirSync(dir, { recursive: true });
  const file = join(dir, snapshotFilename(s));
  writeFileSync(file, JSON.stringify(s, null, 2));
  writeFileSync(join(dir, "latest.json"), JSON.stringify(s, null, 2));
  return file;
}

export function loadSnapshots(workspaceRoot: string, ticker: string): PvreSnapshot[] {
  const dir = join(workspaceRoot, ".penman", "pvre", ticker.toLowerCase());
  if (!existsSync(dir)) return [];
  const out: PvreSnapshot[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "latest.json") continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf-8")) as PvreSnapshot;
      if (parsed.schemaVersion === "2026-08-pvre-snapshot-v1") out.push(parsed);
    } catch {
      // ignore corrupt files — persistence is best-effort
    }
  }
  return out.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}
