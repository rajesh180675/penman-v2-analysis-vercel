#!/usr/bin/env tsx
/**
 * company-run.ts — forecast accountability for ONE company (one process per
 * company: loading the whole corpus in one process exhausts memory on Windows).
 *
 *   node --import tsx/esm --import ./scripts/lib/register-raw-loader.mjs \
 *     scripts/accountability/company-run.ts --ticker=ITC [--made-at=YYYY-MM-DD]
 *
 * Writes accountability/runs/<ticker>.json:
 *   - the walk-forward backtest of the base forecast over every cutoff, on
 *     the valuation basis of the app's own run,
 *   - the core-RNOA series feeding the panel persistence estimate,
 *   - today's forecast snapshot, from the same run (appSnapshot.ts); run-all
 *     freezes it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import { walkForwardCompany } from "../../src/engine/accountability";
import { ACTIVE_MARKET_PACKS } from "../../src/engine/marketPacks";
import type { PipelineResult } from "../../src/engine/pipeline";
import type { SegmentData } from "../../src/engine/segmentParser";
import type { EngineConfig, RawPeriodData, RecastPeriod } from "../../src/engine/types";
import type { ValuationCommandCenterOutput } from "../../src/engine/valuationCommandCenter";
import { buildValuationBasis, windowValuationBasis } from "../../src/engine/valuationBasis";
import { runLibraryCompany } from "../lib/libraryCompanyRun";
import { snapshotFromAppRun } from "./appSnapshot";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const COMPANIES = join(ROOT, "public", "data", "companies");

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const ticker = arg("ticker");
const madeAt = arg("made-at") ?? new Date().toISOString().slice(0, 10);
if (!ticker) throw new Error("--ticker is required");

const registry: LibraryCompany[] = JSON.parse(readFileSync(join(COMPANIES, "registry.json"), "utf-8"));
const company = registry.find((c) => c.ticker === ticker);
if (!company) throw new Error(`Unknown ticker ${ticker}`);

// The app's own run, dated at the freeze: its accounts (standalone where the
// consolidated history is short), its recast, and the forecast it shows.
const state = await runLibraryCompany(ROOT, company, { now: new Date(`${madeAt}T00:00:00.000Z`) });
if (state.status !== "ready") throw new Error(state.message);
const run = state.result.materialization as unknown as {
  config: EngineConfig;
  rawData: RawPeriodData[];
  segmentData: SegmentData | null;
  pipelineResult: PipelineResult | null;
  analysisWindow: { includedPeriods: string[] } | null;
  commandCenter: ValuationCommandCenterOutput | null;
};
if (!run.pipelineResult) throw new Error("The app's run produced no recast");
const config = run.config;

const outDir = join(ROOT, "accountability", "runs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${ticker}.json`);

if (run.pipelineResult.analysisFamily !== "industrial") {
  writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, skipped: `analysis family ${run.pipelineResult.analysisFamily}: the base forecast engine is industrial-only` }, null, 1));
  process.exit(0);
}

// The business the app's valuation forecasts, over the whole history
// (valuationBasis): every year at a twelve-month rate, and a lending arm
// carved out where the valuation carves one. Its forecasts are scored against
// that business's actuals. Scored on the consolidated statements instead, the
// record measured a forecast the app does not make: Grasim's margin forecast
// beat a random walk 9 times in 10 with its lender inside, and 0 in 3 on the
// business the app values. The carve needs the arm's own figures, so a carved
// history starts where they do.
const filed: RecastPeriod[] = [...run.pipelineResult.periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
const basis = buildValuationBasis({
  ticker: config.ticker,
  periods: filed,
  rawData: run.rawData,
  segmentData: run.segmentData,
  config,
  packs: { ...ACTIVE_MARKET_PACKS, analysisAsOf: madeAt },
  asOf: madeAt,
});
// The run built the same basis; windowed, it is what its command center valued.
// A runner that builds it differently would score another business again.
if (run.commandCenter && run.analysisWindow) {
  const key = (periods: readonly RecastPeriod[]) => periods.map((p) => `${p.period_end}:${p.is.Sales}:${p.bs.NOA}`).join("|");
  if (key(windowValuationBasis(basis, run.analysisWindow.includedPeriods).periods) !== key(run.commandCenter.basisPeriods)) {
    throw new Error("The walk-forward's valuation basis differs from the one the app's run valued");
  }
}
const periods = basis.periods;
if (periods.length < 2) {
  writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, skipped: "fewer than two periods on the valuation basis" }, null, 1));
  process.exit(0);
}

const walkForward = walkForwardCompany(periods, config, { ticker, companyType: company.type });

// Core RNOA on opening NOA, by fiscal year — the panel persistence input.
const rnoaPoints = periods.slice(1).flatMap((p, i) => {
  const opening = periods[i]!.bs.NOA;
  const coreOI = p.cu?.CoreOI ?? p.is.OI;
  return opening > 0 && Number.isFinite(coreOI) ? [{ year: Number(p.period_end.slice(0, 4)), rnoa: coreOI / opening }] : [];
});

// Today's forecast, frozen from the same run (appSnapshot.ts).
const snapshot = snapshotFromAppRun(state, company, madeAt);

const carvedLendingArm = basis.lendingArm?.status === "applied" ? basis.lendingArm.link.arm.name : null;
writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, carvedLendingArm, walkForward, rnoaPoints, snapshot }, null, 1));
