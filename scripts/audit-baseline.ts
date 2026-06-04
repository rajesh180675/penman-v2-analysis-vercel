#!/usr/bin/env tsx
/**
 * audit-baseline.ts — Capture per-company audit baseline for cross-phase regression diffing.
 *
 * Reuses the same company-type-aware auditCompanyRun helper as
 * audit-all-companies, then enriches the JSON with traceability policy versions
 * so post-phase changes show up in diffs.
 *
 * Usage:
 *   npx tsx scripts/audit-baseline.ts --label=phase1
 *   npx tsx scripts/audit-baseline.ts --label=phase2 --ticker=ITC   # spot-check
 *
 * Output: audit-baselines/<label>.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAnalysisPolicyVersions } from "../src/engine/policyVersions";
import {
  auditCompanyRun,
  type AuditCompanyRunResult,
  type AuditRegistryEntry,
} from "./lib/auditCompanyRun";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const COMPANIES_DIR = join(PROJECT_ROOT, "public", "data", "companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const BASELINES_DIR = join(PROJECT_ROOT, "audit-baselines");

interface BaselineEntry {
  folder: string;
  ticker: string;
  type: string;
  companyType: string;
  family?: "industrial" | "financial-institution";
  analysisFamily: AuditCompanyRunResult["analysisFamily"];
  pipelineStrategyId: string | null;
  statusClass: AuditCompanyRunResult["statusClass"];
  outcome: AuditCompanyRunResult["outcome"];
  modelApplicability: AuditCompanyRunResult["modelApplicability"];
  periods: number;
  latestPeriod: string | null;
  valuation: AuditCompanyRunResult["valuation"];
  bankValuation: AuditCompanyRunResult["bankValuation"];
  rigor: AuditCompanyRunResult["rigor"];
  flags: string[];
  error?: string;
}

const args = {
  label: null as string | null,
  ticker: null as string | null,
  limit: null as number | null,
};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--label=")) args.label = arg.split("=")[1];
  else if (arg.startsWith("--ticker=")) args.ticker = arg.split("=")[1];
  else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1] ?? "", 10);
}
if (!args.label) {
  console.error("ERROR: --label=<name> is required (e.g. --label=phase1)");
  process.exit(2);
}

const registry: AuditRegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
let companies = registry;
if (args.ticker) {
  const needle = args.ticker.toUpperCase();
  companies = registry.filter((c) => c.ticker.toUpperCase() === needle || c.folder.toUpperCase() === needle);
} else if (args.limit) {
  companies = registry.slice(0, args.limit);
}

function toBaselineEntry(result: AuditCompanyRunResult): BaselineEntry {
  return {
    folder: result.folder,
    ticker: result.ticker,
    type: result.type,
    companyType: result.companyType,
    family: result.analysisFamily === "unknown" ? undefined : result.analysisFamily,
    analysisFamily: result.analysisFamily,
    pipelineStrategyId: result.pipelineStrategyId,
    statusClass: result.statusClass,
    outcome: result.outcome,
    modelApplicability: result.modelApplicability,
    periods: result.periods,
    latestPeriod: result.latestPeriod,
    valuation: result.valuation,
    bankValuation: result.bankValuation,
    rigor: result.rigor,
    flags: result.flags,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function run() {
  console.log(`Capturing baseline "${args.label}" for ${companies.length} companies…`);
  const out: BaselineEntry[] = [];
  for (const company of companies) {
    process.stdout.write(`  ${company.folder.padEnd(35)} `);
    const result = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT });
    out.push(toBaselineEntry(result));
    console.log(result.flags.length ? `FLAGGED (${result.flags.join(",")})` : `OK ${result.rigor.currentLevel ?? "?"}`);
  }

  if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });
  const outPath = join(BASELINES_DIR, `${args.label}.json`);
  writeFileSync(outPath, JSON.stringify({
    label: args.label,
    capturedAt: new Date().toISOString(),
    policyVersions: getAnalysisPolicyVersions(),
    entries: out,
  }, null, 2));
  console.log(`\nWrote ${outPath} (${out.length} entries)`);
}

run().catch((err) => { console.error("FATAL:", err); process.exit(1); });
