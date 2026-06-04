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

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCompanyRun,
  type AuditCompanyRunResult,
  type AuditOutcome,
  type AuditRegistryEntry,
} from "./lib/auditCompanyRun";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const COMPANIES_DIR = join(PROJECT_ROOT, "public", "data", "companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");

const registry: AuditRegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

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
  "Company                   | CompanyType  | AnalysisFamily        | Strategy     | StatusClass    | Periods | Stress   | Base     | Bull     | Triang   | SOTP     | Models | Outcome                       | Applicability        | Flags",
);
console.log("-".repeat(230));

function formatNumber(value: number | null): string {
  return value !== null ? value.toFixed(2).padStart(8) : "N/A".padStart(8);
}

function formatModels(models: string[]): string {
  const text = models.length ? models.join("+") : "—";
  return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

function formatApplicability(result: AuditCompanyRunResult): string {
  const industrial = result.modelApplicability.industrialCommandCenter.status;
  const financial = result.modelApplicability.financialInstitutionValuation.status;
  const text = result.analysisFamily === "financial-institution"
    ? `fin:${financial}`
    : `ind:${industrial}`;
  return text.length > 20 ? `${text.slice(0, 19)}…` : text;
}

function printResult(result: AuditCompanyRunResult): void {
  const flagStr = result.flags.length ? result.flags.join(",") : "OK";
  const familyLabel = result.subtype ? `${result.analysisFamily}/${result.subtype}` : result.analysisFamily;
  console.log(
    `${result.folder.padEnd(25)} | ${result.companyType.padEnd(12)} | ${familyLabel.padEnd(21)} | ` +
    `${(result.pipelineStrategyId ?? "—").padEnd(12)} | ` +
    `${result.statusClass.padEnd(14)} | ` +
    `${String(result.periods).padStart(3)} | ` +
    `${formatNumber(result.stress)} | ` +
    `${formatNumber(result.base)} | ` +
    `${formatNumber(result.bull)} | ` +
    `${formatNumber(result.triangulatedValue)} | ` +
    `${formatNumber(result.sotp)} | ` +
    `${formatModels(result.models).padEnd(12)} | ` +
    `${result.outcome.padEnd(29)} | ` +
    `${formatApplicability(result).padEnd(20)} | ` +
    `${flagStr}`,
  );
}

// Process sequentially to avoid OOM.
async function run() {
  const results: AuditCompanyRunResult[] = [];
  for (const company of companies) {
    const result = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT, verbose: args.verbose });
    results.push(result);
    printResult(result);
  }

  const byOutcome = new Map<AuditOutcome, number>();
  for (const result of results) {
    byOutcome.set(result.outcome, (byOutcome.get(result.outcome) ?? 0) + 1);
  }
  const calcErrors = results.filter((r) => r.outcome === "CALC_ERROR");
  const actionable = results.filter((r) => r.outcome === "CALC_ERROR" || r.outcome === "MODEL_GAP" || r.outcome === "POLICY_WARNING");
  const nonCalcError = results.length - calcErrors.length;

  console.log("\n" + "=".repeat(230));
  console.log(`AUDIT SUMMARY: ${nonCalcError}/${results.length} without calculation errors`);
  console.log("OUTCOMES:");
  for (const outcome of ["OK_COMPUTED", "EXPECTED_SKIP_MISSING_SIDECAR", "EXPECTED_SCOPE_CAP", "MODEL_GAP", "POLICY_WARNING", "CALC_ERROR"] as AuditOutcome[]) {
    console.log(`  ${outcome}: ${byOutcome.get(outcome) ?? 0}`);
  }

  if (actionable.length) {
    console.log(`\nACTIONABLE (${actionable.length}):`);
    for (const r of actionable) {
      console.log(`  ${r.folder} (${r.ticker}, ${r.companyType}, ${r.analysisFamily}): ${r.flags.join(", ")}`);
    }
  }
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
