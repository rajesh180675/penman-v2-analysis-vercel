#!/usr/bin/env tsx
/**
 * company-run.ts — forecast accountability for ONE company (one process per
 * company: loading the whole corpus in one process exhausts memory on Windows).
 *
 *   npx tsx scripts/accountability/company-run.ts --ticker=ITC [--made-at=YYYY-MM-DD]
 *
 * Writes accountability/runs/<ticker>.json:
 *   - the walk-forward backtest of the base forecast over every cutoff,
 *   - the core-RNOA series feeding the panel persistence estimate,
 *   - today's frozen forecast snapshot (written separately by run-all).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../../src/engine/capitalineParser";
import { processCompanyDataFull } from "../../src/engine/pipeline";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../src/engine/types";
import { buildValuationCommandCenter } from "../../src/engine/valuationCommandCenter/core";
import { buildScenario } from "../../src/engine/forecastingEngine";
import { ACTIVE_MARKET_PACKS } from "../../src/engine/marketPacks";
import { buildForecastSnapshot, walkForwardCompany } from "../../src/engine/accountability";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const COMPANIES = join(ROOT, "public", "data", "companies");

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const ticker = arg("ticker");
const madeAt = arg("made-at") ?? new Date().toISOString().slice(0, 10);
if (!ticker) throw new Error("--ticker is required");

const registry: { folder: string; ticker: string; type: string }[] =
  JSON.parse(readFileSync(join(COMPANIES, "registry.json"), "utf-8"));
const company = registry.find((c) => c.ticker === ticker);
if (!company) throw new Error(`Unknown ticker ${ticker}`);

const buf = readFileSync(join(COMPANIES, company.folder, `${company.folder}.zip`));
const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
  companyId: company.folder,
  filename: `${company.folder}.zip`,
});
const config = { ...DEFAULT_CONFIG, company_type: company.type as typeof DEFAULT_CONFIG.company_type, ticker: company.ticker };
const pipeline = processCompanyDataFull(parsed.periods, config);
const periods: RecastPeriod[] = [...pipeline.periods].sort((a, b) => a.period_end.localeCompare(b.period_end));

const outDir = join(ROOT, "accountability", "runs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${ticker}.json`);

if (pipeline.analysisFamily !== "industrial" || periods.length < 2) {
  writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, skipped: `analysis family ${pipeline.analysisFamily}: the base forecast engine is industrial-only` }, null, 1));
  process.exit(0);
}

const walkForward = walkForwardCompany(periods, config, { ticker, companyType: company.type });

// Core RNOA on opening NOA, by fiscal year — the panel persistence input.
const rnoaPoints = periods.slice(1).flatMap((p, i) => {
  const opening = periods[i]!.bs.NOA;
  const coreOI = p.cu?.CoreOI ?? p.is.OI;
  return opening > 0 && Number.isFinite(coreOI) ? [{ year: Number(p.period_end.slice(0, 4)), rnoa: coreOI / opening }] : [];
});

// Today's forecast, exactly as the Valuation tab's command center makes it.
let snapshot = null;
try {
  const cc = buildValuationCommandCenter({ data: periods, config, ...ACTIVE_MARKET_PACKS, analysisAsOf: madeAt });
  const base = cc.scenarios.find((s) => s.key === "base");
  const anchorIndex = cc.valuationReadiness.anchorIndex;
  const cutoff = periods[Math.max(1, anchorIndex)]!;
  if (base) {
    snapshot = {
      ...buildForecastSnapshot({
        ticker,
        companyType: company.type,
        madeAt,
        cutoff,
        forecast: buildScenario(base.scenario, cutoff),
        assumptions: { ke: base.assumptions.ke, kw: base.assumptions.kw, g: base.assumptions.g },
        intrinsicPerShare: base.intrinsicPerShare ?? null,
      }),
      latestReportedPeriod: periods[periods.length - 1]!.period_end,
    };
  }
} catch (error) {
  snapshot = { error: error instanceof Error ? error.message : String(error) };
}

writeFileSync(outPath, JSON.stringify({ ticker, companyType: company.type, walkForward, rnoaPoints, snapshot }, null, 1));
