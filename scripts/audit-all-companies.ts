#!/usr/bin/env tsx
/**
 * audit-all-companies.ts — Rigorous valuation audit across all companies.
 *
 * Loads each company's ZIP, parses Capitaline data, runs the same explicit
 * company-type routing used by the app, and reports valuation health per
 * family. Industrial companies use the Valuation Command Center; banks, NBFCs,
 * and insurers use pipeline.bankResult.valuation instead of being forced
 * through the industrial command center.
 *
 * Usage:
 *   npx tsx scripts/audit-all-companies.ts              # full audit
 *   npx tsx scripts/audit-all-companies.ts --limit=3    # only first 3
 *   npx tsx scripts/audit-all-companies.ts --ticker=ITC # single company
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { processCompanyDataFull } from "../src/engine/pipeline";
import { buildValuationCommandCenter } from "../src/engine/valuationCommandCenter";
import { DEFAULT_CONFIG, type EngineConfig } from "../src/engine/types";
import {
  validateBankQualityIndicators,
  type BankQualityIndicators,
} from "../src/engine/bankQualityIndicators";
import type {
  BankValuationBundle,
  BankValuationModelResult,
} from "../src/engine/bankValuation";
import type { AllSegmentData, SegmentData } from "../src/engine/segmentParser";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const PROJECT_ROOT = resolve(__dirname, "..");
const COMPANIES_DIR = join(PROJECT_ROOT, "public", "data", "companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");

interface RegistryEntry {
  folder: string;
  name: string;
  ticker: string;
  type: string;
  hasStandalone?: boolean;
}

type AuditOutcome =
  | "OK_COMPUTED"
  | "EXPECTED_SKIP_MISSING_SIDECAR"
  | "EXPECTED_SCOPE_CAP"
  | "MODEL_GAP"
  | "CALC_ERROR"
  | "POLICY_WARNING";

const registry: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

const args = {
  limit: null as number | null,
  ticker: null as string | null,
  verbose: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--verbose") args.verbose = true;
  else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1] ?? "", 10);
  else if (arg.startsWith("--ticker=")) args.ticker = arg.split("=")[1] ?? null;
  else if (arg === "--help") {
    console.log("Usage: npx tsx scripts/audit-all-companies.ts [--limit=N] [--ticker=TICKER] [--verbose]");
    process.exit(0);
  }
}

let companies = registry;
if (args.ticker) {
  const needle = args.ticker.toUpperCase();
  companies = registry.filter((c) => c.ticker.toUpperCase() === needle || c.folder.toUpperCase() === needle);
} else if (args.limit) {
  companies = registry.slice(0, args.limit);
}

console.log(`Auditing ${companies.length} companies...`);
console.log(
  "Company                   | Type         | Family                | Periods | Stress   | Base     | Bull     | Triang   | SOTP     | Models | Outcome                       | Flags",
);
console.log("-".repeat(185));

interface AuditResult {
  folder: string;
  ticker: string;
  type: string;
  family: "industrial" | "financial-institution" | "unknown";
  subtype: string | null;
  periods: number;
  stress: number | null;
  base: number | null;
  bull: number | null;
  triangulatedValue: number | null;
  sotp: number | null;
  models: string[];
  outcome: AuditOutcome;
  flags: string[];
}

function emptyResult(company: RegistryEntry): AuditResult {
  return {
    folder: company.folder,
    ticker: company.ticker,
    type: company.type,
    family: "unknown",
    subtype: null,
    periods: 0,
    stress: null,
    base: null,
    bull: null,
    triangulatedValue: null,
    sotp: null,
    models: [],
    outcome: "CALC_ERROR",
    flags: [],
  };
}

function deriveOutcome(flags: string[], hasComputedValue: boolean): AuditOutcome {
  if (flags.some((f) => f.startsWith("ERROR") || f.startsWith("CALC_ERROR") || f.endsWith("_INVALID"))) {
    return "CALC_ERROR";
  }
  if (flags.some((f) => f.startsWith("MODEL_GAP") || f === "CONGLO_NO_SOTP" || f === "NO_SCENARIOS")) {
    return "MODEL_GAP";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SCOPE_CAP"))) {
    return "EXPECTED_SCOPE_CAP";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SKIP_MISSING_SIDECAR"))) {
    return "EXPECTED_SKIP_MISSING_SIDECAR";
  }
  if (flags.length > 0) {
    return "POLICY_WARNING";
  }
  return hasComputedValue ? "OK_COMPUTED" : "MODEL_GAP";
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pushInvalidIfComputed(flags: string[], label: string, model: BankValuationModelResult | undefined): void {
  if (!model || model.status !== "computed") return;
  if (model.intrinsicValue == null || !Number.isFinite(model.intrinsicValue)) {
    flags.push(`${label}_INVALID`);
  }
}

function computedModelNames(valuation: BankValuationBundle | null | undefined): string[] {
  if (!valuation) return [];
  const names: string[] = [];
  if (valuation.justifiedPB.status === "computed") names.push("PB");
  if (valuation.equityResidualIncome.status === "computed") names.push("ERI");
  if (valuation.sustainableDDM.status === "computed") names.push("DDM");
  if (valuation.evBased?.status === "computed") names.push("EV");
  if (valuation.pAum?.status === "computed") names.push("P/AUM");
  if (valuation.roaLeverageRI?.status === "computed") names.push("ROA×LevRI");
  return names;
}

function loadQualitySidecar(folder: string): { quality: BankQualityIndicators | null; flags: string[] } {
  const sidecarPath = join(COMPANIES_DIR, folder, "quality_indicators.json");
  if (!existsSync(sidecarPath)) return { quality: null, flags: [] };

  try {
    const payload = JSON.parse(readFileSync(sidecarPath, "utf-8")) as unknown;
    const validation = validateBankQualityIndicators(payload);
    if (!validation.ok) {
      const errors = validation.issues
        .filter((issue) => issue.severity === "error")
        .slice(0, 3)
        .map((issue) => `${issue.field}:${issue.message}`)
        .join(";");
      return { quality: null, flags: [`CALC_ERROR:QUALITY_SIDECAR_INVALID:${errors}`] };
    }
    return { quality: payload as BankQualityIndicators, flags: [] };
  } catch (error) {
    return { quality: null, flags: [`CALC_ERROR:QUALITY_SIDECAR_PARSE:${(error as Error).message}`] };
  }
}

function selectBusinessSegmentData(segmentData: AllSegmentData | null): SegmentData | null {
  return segmentData?.business ?? segmentData?.mixed ?? null;
}

function auditFinancialResult(
  company: RegistryEntry,
  pipeline: ReturnType<typeof processCompanyDataFull>,
  sidecarFlags: string[],
): AuditResult {
  const result = emptyResult(company);
  const flags = [...sidecarFlags];
  const bankResult = pipeline.bankResult;

  result.family = "financial-institution";
  result.subtype = bankResult?.subtype ?? null;
  result.periods = bankResult?.bankMetrics?.length ?? bankResult?.periods.length ?? 0;

  if (!bankResult) {
    flags.push("CALC_ERROR:NO_BANK_RESULT");
    result.flags = flags;
    result.outcome = deriveOutcome(flags, false);
    return result;
  }

  const valuation = bankResult.valuation;
  if (!valuation) {
    flags.push("MODEL_GAP:NO_FINANCIAL_VALUATION");
  } else {
    pushInvalidIfComputed(flags, "JUSTIFIED_PB", valuation.justifiedPB);
    pushInvalidIfComputed(flags, "EQUITY_RI", valuation.equityResidualIncome);
    pushInvalidIfComputed(flags, "SUSTAINABLE_DDM", valuation.sustainableDDM);
    pushInvalidIfComputed(flags, "EV_BASED", valuation.evBased);
    pushInvalidIfComputed(flags, "P_AUM", valuation.pAum);
    pushInvalidIfComputed(flags, "ROA_LEVERAGE_RI", valuation.roaLeverageRI);

    result.models = computedModelNames(valuation);
    result.triangulatedValue = finiteOrNull(valuation.triangulatedValue);

    const cards = valuation.scenarios?.cards ?? [];
    result.stress = finiteOrNull(cards.find((card) => card.key === "stress")?.intrinsicValue);
    result.base = finiteOrNull(cards.find((card) => card.key === "base")?.intrinsicValue);
    result.bull = finiteOrNull(cards.find((card) => card.key === "bull")?.intrinsicValue);
    result.sotp = finiteOrNull(valuation.sotp?.totalEnterpriseValue);

    if (bankResult.subtype === "insurance") {
      if (valuation.evBased?.status !== "computed") {
        const reason = valuation.evBased?.reason ?? "insurance EV/VNB valuation did not compute";
        const tag = reason.toLowerCase().includes("sidecar") || reason.toLowerCase().includes("embedded value")
          ? "EXPECTED_SKIP_MISSING_SIDECAR:INSURANCE_EV_VNB"
          : "MODEL_GAP:INSURANCE_EV_VNB";
        flags.push(tag);
        if (args.verbose) flags.push(`DETAIL:${reason}`);
      }
    } else if (result.triangulatedValue == null || result.models.length === 0) {
      flags.push("MODEL_GAP:NO_FINANCIAL_TRIANGULATION");
    }
  }

  result.flags = flags;
  result.outcome = deriveOutcome(flags, result.triangulatedValue != null || result.models.length > 0);
  return result;
}

function auditIndustrialResult(
  company: RegistryEntry,
  pipeline: ReturnType<typeof processCompanyDataFull>,
  parsedSegmentData: SegmentData | null | undefined,
): AuditResult {
  const result = emptyResult(company);
  result.family = "industrial";
  result.periods = pipeline.periods.length;

  const flags: string[] = [];

  const config = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
  const valuation = buildValuationCommandCenter({
    data: pipeline.periods,
    config,
    marketData: null,
    analysisStatus: null,
    segmentData: parsedSegmentData || null,
  });

  const scenarios = valuation.scenarios || [];
  result.stress = finiteOrNull(scenarios.find((s) => s.key === "stress")?.intrinsicPerShare);
  result.base = finiteOrNull(scenarios.find((s) => s.key === "base")?.intrinsicPerShare);
  result.bull = finiteOrNull(scenarios.find((s) => s.key === "bull")?.intrinsicPerShare);
  result.triangulatedValue = result.base;
  result.sotp = finiteOrNull(valuation.sotp?.totalEnterpriseValue);
  result.models = scenarios.length ? ["VCC"] : [];

  if (scenarios.length === 0) flags.push("NO_SCENARIOS");
  if (result.stress === null && scenarios.some((s) => s.key === "stress")) flags.push("STRESS_INVALID");
  if (result.base === null && scenarios.some((s) => s.key === "base")) flags.push("BASE_INVALID");
  if (result.bull === null && scenarios.some((s) => s.key === "bull")) flags.push("BULL_INVALID");
  // Scenario ordering and negative base values are economic diagnostics, not
  // audit blockers. For cyclicals, loss-makers, and capex-heavy compounders a
  // conservative base can legitimately sit above/below adjacent scenario cards
  // depending on the selected primary valuation family. Keep the CLI fail-closed
  // only on missing/invalid computed values; surface scenario shape in the
  // printed numbers instead of converting real outputs into policy warnings.

  const revDcf = valuation.reverseDcf?.impliedOwnerEarningsGrowth ?? null;
  if (revDcf !== null && !Number.isFinite(revDcf)) flags.push("REVDCF_INVALID");
  if (company.type === "conglomerate" && result.sotp === null) flags.push("MODEL_GAP:CONGLO_NO_SOTP");

  const epv = valuation.epv?.epvPerShare ?? null;
  if (epv !== null && !Number.isFinite(epv)) flags.push("EPV_INVALID");
  const evEbitda = valuation.evEbitda?.enterpriseValue ?? null;
  if (evEbitda !== null && !Number.isFinite(evEbitda)) flags.push("EVEBITDA_INVALID");

  result.flags = flags;
  result.outcome = deriveOutcome(flags, result.base != null);
  return result;
}

async function auditCompany(company: RegistryEntry): Promise<AuditResult> {
  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);

  if (!existsSync(zipPath)) {
    const result = emptyResult(company);
    result.flags = ["CALC_ERROR:MISSING_ZIP"];
    result.outcome = deriveOutcome(result.flags, false);
    return result;
  }

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
    const { quality, flags: sidecarFlags } = loadQualitySidecar(company.folder);
    const pipeline = processCompanyDataFull(parsed.periods, config, quality);

    if (pipeline.analysisFamily === "financial-institution") {
      return auditFinancialResult(company, pipeline, sidecarFlags);
    }

    const result = auditIndustrialResult(company, pipeline, selectBusinessSegmentData(parsed.segmentData));
    result.flags = [...sidecarFlags, ...result.flags];
    result.outcome = deriveOutcome(result.flags, result.base != null || result.triangulatedValue != null);
    return result;
  } catch (error) {
    const result = emptyResult(company);
    result.flags = [`CALC_ERROR:${(error as Error).message}`];
    result.outcome = deriveOutcome(result.flags, false);
    return result;
  }
}

function formatNumber(value: number | null): string {
  return value !== null ? value.toFixed(2).padStart(8) : "N/A".padStart(8);
}

function formatModels(models: string[]): string {
  const text = models.length ? models.join("+") : "—";
  return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

// Process sequentially to avoid OOM.
async function run() {
  const results: AuditResult[] = [];
  for (const company of companies) {
    const result = await auditCompany(company);
    results.push(result);
    const flagStr = result.flags.length ? result.flags.join(",") : "OK";
    const familyLabel = result.subtype ? `${result.family}/${result.subtype}` : result.family;
    console.log(
      `${result.folder.padEnd(25)} | ${result.type.padEnd(12)} | ${familyLabel.padEnd(21)} | ${String(result.periods).padStart(3)} | ` +
      `${formatNumber(result.stress)} | ` +
      `${formatNumber(result.base)} | ` +
      `${formatNumber(result.bull)} | ` +
      `${formatNumber(result.triangulatedValue)} | ` +
      `${formatNumber(result.sotp)} | ` +
      `${formatModels(result.models).padEnd(12)} | ` +
      `${result.outcome.padEnd(29)} | ` +
      `${flagStr}`,
    );
  }

  const byOutcome = new Map<AuditOutcome, number>();
  for (const result of results) {
    byOutcome.set(result.outcome, (byOutcome.get(result.outcome) ?? 0) + 1);
  }
  const calcErrors = results.filter((r) => r.outcome === "CALC_ERROR");
  const actionable = results.filter((r) => r.outcome === "CALC_ERROR" || r.outcome === "MODEL_GAP" || r.outcome === "POLICY_WARNING");
  const nonCalcError = results.length - calcErrors.length;

  console.log("\n" + "=".repeat(185));
  console.log(`AUDIT SUMMARY: ${nonCalcError}/${results.length} without calculation errors`);
  console.log("OUTCOMES:");
  for (const outcome of ["OK_COMPUTED", "EXPECTED_SKIP_MISSING_SIDECAR", "EXPECTED_SCOPE_CAP", "MODEL_GAP", "POLICY_WARNING", "CALC_ERROR"] as AuditOutcome[]) {
    console.log(`  ${outcome}: ${byOutcome.get(outcome) ?? 0}`);
  }

  if (actionable.length) {
    console.log(`\nACTIONABLE (${actionable.length}):`);
    for (const r of actionable) {
      console.log(`  ${r.folder} (${r.ticker}, ${r.type}, ${r.family}): ${r.flags.join(", ")}`);
    }
  }
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
