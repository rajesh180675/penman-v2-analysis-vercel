#!/usr/bin/env tsx
/**
 * refresh-expectations.ts — Regenerate expectations.json files from current
 * pipeline outputs (sector-aware).
 *
 * Captures CURRENT state of the engine as the regression baseline.
 * Industrial companies write RNOA/ROCE/NFO_to_CSE bands;
 * banks/NBFCs write NIM/ROA/ROE/leverage/spread/creditCost/costToIncome bands;
 * insurers write claimsRatio/expenseRatio/combinedRatio/floatToEquity bands.
 *
 * Aspirational fields (originally captured as targets) are preserved in the
 * `targetState` block so the gap stays visible.
 *
 * Usage:
 *   npx tsx scripts/refresh-expectations.ts                    # all 33 companies
 *   npx tsx scripts/refresh-expectations.ts --folder=ITC       # one
 *   npx tsx scripts/refresh-expectations.ts --type=bank        # all banks
 *   npx tsx scripts/refresh-expectations.ts --pct=0.10         # ±10% bands
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { processCompanyDataFull } from "../src/engine/pipeline";
import { buildAnalysisTraceability } from "../src/engine/analysisTraceability";
import { getAnalysisPolicyVersions } from "../src/engine/policyVersions";
import { DEFAULT_CONFIG, EngineConfig } from "../src/engine/types";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const COMPANIES_DIR = join(PROJECT_ROOT, "public", "data", "companies");

interface RegistryEntry { folder: string; ticker: string; type: string; }
const registry = JSON.parse(
  readFileSync(join(COMPANIES_DIR, "registry.json"), "utf-8"),
) as RegistryEntry[];

const args = { folder: null as string | null, type: null as string | null, pct: 0.05 };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--folder=")) args.folder = a.split("=")[1];
  else if (a.startsWith("--type=")) args.type = a.split("=")[1];
  else if (a.startsWith("--pct=")) args.pct = Number(a.split("=")[1]);
}

const targets = args.folder
  ? registry.filter((r) => r.folder === args.folder)
  : args.type
    ? registry.filter((r) => r.type === args.type)
    : registry;

interface ExpectationsContract {
  companyId: string;
  companyName: string;
  profile?: string;
  expectedRigorLevel: string;
  expectedParserFidelityStatus: string;
  expectedReconciliationStatus: string;
  expectedEconomicSanityStatus: string;
  expectedConceptIdentityStatus: string;
  keyMetricTolerances: Record<string, { min: number; max: number }>;
  expectedAnomalyFlags: string[];
  expectedUnusualItemCount: { min: number; max: number };
  expectedRunsCleanWorkbook: boolean;
  notes?: string;
  targetState?: Record<string, unknown>;
  capturedAt?: string;
}

function band(value: number | null | undefined, pct = args.pct): { min: number; max: number } | null {
  if (value == null || !Number.isFinite(value)) return null;
  // 0.5pp absolute floor on band width — protects metrics like ROA (~1%)
  // where ±5% relative is within float-rounding noise.
  const padding = Math.max(Math.abs(value) * pct, 0.005);
  return { min: Number((value - padding).toFixed(4)), max: Number((value + padding).toFixed(4)) };
}

function safeRatio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

async function refreshOne(company: RegistryEntry) {
  const path = join(COMPANIES_DIR, company.folder, "expectations.json");
  if (!existsSync(path)) {
    console.log(`  ${company.folder}: SKIP (no expectations.json)`);
    return;
  }
  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);
  if (!existsSync(zipPath)) {
    console.log(`  ${company.folder}: SKIP (no zip)`);
    return;
  }

  const existing = JSON.parse(readFileSync(path, "utf-8")) as ExpectationsContract;

  let parsed;
  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
  } catch (err) {
    console.log(`  ${company.folder}: SKIP (parse failed: ${(err as Error).message})`);
    return;
  }

  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    company_type: company.type as EngineConfig["company_type"],
  };

  let pipeline;
  try {
    pipeline = processCompanyDataFull(parsed.periods, config);
  } catch (err) {
    console.log(`  ${company.folder}: SKIP (pipeline failed: ${(err as Error).message})`);
    return;
  }

  const trace = buildAnalysisTraceability({
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    runId: `refresh-${company.folder}`,
    companyId: company.folder,
    sourceMode: "capitaline",
    recastData: pipeline.periods,
    config,
    rawData: parsed.periods,
    periodCount: parsed.periods.length,
    recastPeriodCount: pipeline.periods.length,
    latestPeriod: parsed.periods[parsed.periods.length - 1]?.period_end ?? null,
    policyVersions: getAnalysisPolicyVersions(),
    debugInfo: parsed.debug,
    hasDebugInfo: Boolean(parsed.debug),
    debugFiles: parsed.debug?.files?.length ?? 0,
    rawMetricKeyCount: parsed.debug?.rawMetricKeys?.length ?? 0,
    bankMetrics: pipeline.bankResult?.bankMetrics ?? null,
    bankSubtype: pipeline.bankResult?.subtype ?? null,
  });

  const observedAnomalyFlags = pipeline.anomalies.terminalFlags
    .map((f) => f.spec_id)
    .filter((c): c is string => typeof c === "string");

  // Build sector-appropriate metric bands.
  let metricTolerances: Record<string, { min: number; max: number }> = {};
  let metricSummary = "";

  if (pipeline.analysisFamily === "industrial") {
    const latest = pipeline.periods[pipeline.periods.length - 1];
    if (!latest) {
      console.log(`  ${company.folder}: SKIP (no recast periods)`);
      return;
    }
    const rnoaBand = band(latest.ratios?.RNOA ?? null);
    const roceBand = band(latest.ratios?.ROCE ?? null);
    const nfoCseBand = band(safeRatio(latest.bs.NFO, latest.bs.CSE));
    metricTolerances = {
      ...(rnoaBand ? { RNOA: rnoaBand } : {}),
      ...(roceBand ? { ROCE: roceBand } : {}),
      ...(nfoCseBand ? { NFO_to_CSE: nfoCseBand } : {}),
    };
    metricSummary = `RNOA=${rnoaBand && `[${rnoaBand.min}, ${rnoaBand.max}]`}  ROCE=${roceBand && `[${roceBand.min}, ${roceBand.max}]`}  NFO/CSE=${nfoCseBand && `[${nfoCseBand.min}, ${nfoCseBand.max}]`}`;
  } else {
    // financial-institution path — bank, NBFC, or insurance.
    const bm = pipeline.bankResult?.bankMetrics ?? [];
    const latest = bm[bm.length - 1];
    if (!latest) {
      console.log(`  ${company.folder}: SKIP (no bank metrics)`);
      return;
    }
    const subtype = pipeline.bankResult?.subtype ?? "bank";
    if (subtype === "insurance") {
      const claimsBand = band(latest.claimsRatio);
      const expenseBand = band(latest.expenseRatio);
      const combinedBand = band(latest.combinedRatio);
      const floatBand = band(latest.floatToEquity);
      const investBand = band(latest.investmentYield);
      metricTolerances = {
        ...(claimsBand ? { claimsRatio: claimsBand } : {}),
        ...(expenseBand ? { expenseRatio: expenseBand } : {}),
        ...(combinedBand ? { combinedRatio: combinedBand } : {}),
        ...(floatBand ? { floatToEquity: floatBand } : {}),
        ...(investBand ? { investmentYield: investBand } : {}),
      };
      metricSummary = `claims=${claimsBand && `[${claimsBand.min},${claimsBand.max}]`}  combined=${combinedBand && `[${combinedBand.min},${combinedBand.max}]`}  float=${floatBand && `[${floatBand.min},${floatBand.max}]`}`;
    } else if (subtype === "nbfc" || subtype === "generic-financial") {
      // NBFC: spread/leverage are the right gauges, not NIM (denominator dilutes).
      const roaBand = band(latest.roa);
      const roeBand = band(latest.roe);
      const leverageBand = band(latest.leverage, Math.max(args.pct, 0.10)); // wider — leverage is volatile
      const spreadBand = band(latest.spread);
      const creditCostBand = band(latest.creditCost);
      const costToIncomeBand = band(latest.costToIncome);
      metricTolerances = {
        ...(roaBand ? { ROA: roaBand } : {}),
        ...(roeBand ? { ROE: roeBand } : {}),
        ...(leverageBand ? { leverage: leverageBand } : {}),
        ...(spreadBand ? { spread: spreadBand } : {}),
        ...(creditCostBand ? { creditCost: creditCostBand } : {}),
        ...(costToIncomeBand ? { costToIncome: costToIncomeBand } : {}),
      };
      metricSummary = `ROA=${roaBand && `[${roaBand.min},${roaBand.max}]`}  ROE=${roeBand && `[${roeBand.min},${roeBand.max}]`}  spread=${spreadBand && `[${spreadBand.min},${spreadBand.max}]`}  lev=${leverageBand && `[${leverageBand.min},${leverageBand.max}]`}`;
    } else {
      // bank
      const nimBand = band(latest.nim);
      const roaBand = band(latest.roa);
      const roeBand = band(latest.roe);
      const creditCostBand = band(latest.creditCost);
      const costToIncomeBand = band(latest.costToIncome);
      const casaBand = band(latest.casaRatio);
      metricTolerances = {
        ...(nimBand ? { NIM: nimBand } : {}),
        ...(roaBand ? { ROA: roaBand } : {}),
        ...(roeBand ? { ROE: roeBand } : {}),
        ...(creditCostBand ? { creditCost: creditCostBand } : {}),
        ...(costToIncomeBand ? { costToIncome: costToIncomeBand } : {}),
        ...(casaBand ? { casaRatio: casaBand } : {}),
      };
      metricSummary = `NIM=${nimBand && `[${nimBand.min},${nimBand.max}]`}  ROA=${roaBand && `[${roaBand.min},${roaBand.max}]`}  ROE=${roeBand && `[${roeBand.min},${roeBand.max}]`}  CASA=${casaBand && `[${casaBand.min},${casaBand.max}]`}`;
    }
  }

  const next: ExpectationsContract = {
    ...existing,
    expectedRigorLevel: trace.rigor.currentLevel,
    expectedParserFidelityStatus: trace.parserFidelity.status,
    expectedReconciliationStatus: trace.reconciliation.status,
    expectedAnomalyFlags: observedAnomalyFlags,
    keyMetricTolerances: metricTolerances,
    capturedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    targetState: {
      // Aspirations stay locked here so the gap remains visible.
      expectedRigorLevel: existing.expectedRigorLevel,
      expectedParserFidelityStatus: existing.expectedParserFidelityStatus,
      expectedReconciliationStatus: existing.expectedReconciliationStatus,
      expectedAnomalyFlags: existing.expectedAnomalyFlags,
      // Preserve original tolerances too — useful when a sidecar lands and
      // we get back to (e.g.) the GNPA targets that were captured for HDFC.
      keyMetricTolerances: existing.keyMetricTolerances,
    },
  };

  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `  ${company.folder} [${pipeline.analysisFamily === "industrial" ? "industrial" : pipeline.bankResult?.subtype ?? "bank"}]: rigor=${next.expectedRigorLevel} parser=${next.expectedParserFidelityStatus} recon=${next.expectedReconciliationStatus}`,
  );
  console.log(`            ${metricSummary}`);
}

(async () => {
  console.log(
    `Refreshing expectations for ${targets.length} compan${targets.length === 1 ? "y" : "ies"} (pct=±${(args.pct * 100).toFixed(0)}%)…`,
  );
  for (const t of targets) {
    try {
      await refreshOne(t);
    } catch (err) {
      console.log(`  ${t.folder}: FAILED — ${(err as Error).message}`);
    }
  }
  console.log("Done.");
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
