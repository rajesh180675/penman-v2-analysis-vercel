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
import { loadWalkForwardBasis } from "../lib/walkForwardBasis";
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

const outDir = join(ROOT, "accountability", "runs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${ticker}.json`);

// The app's own run, dated at the freeze, and the business its valuation
// forecasts over the whole history (scripts/lib/walkForwardBasis.ts).
const loaded = await loadWalkForwardBasis(ROOT, company, madeAt);
if (loaded.status === "skipped") {
  writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, skipped: loaded.reason }, null, 1));
  process.exit(0);
}
const { state, config, periods, carvedLendingArm } = loaded;

const walkForward = walkForwardCompany(periods, config, { ticker, companyType: company.type });

// Core RNOA on opening NOA, by fiscal year — the panel persistence input.
const rnoaPoints = periods.slice(1).flatMap((p, i) => {
  const opening = periods[i]!.bs.NOA;
  const coreOI = p.cu?.CoreOI ?? p.is.OI;
  return opening > 0 && Number.isFinite(coreOI) ? [{ year: Number(p.period_end.slice(0, 4)), rnoa: coreOI / opening }] : [];
});

// Today's forecast, frozen from the same run (appSnapshot.ts).
const snapshot = snapshotFromAppRun(state, company, madeAt);

writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, carvedLendingArm, walkForward, rnoaPoints, snapshot }, null, 1));
