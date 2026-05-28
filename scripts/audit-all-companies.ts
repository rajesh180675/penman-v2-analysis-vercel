#!/usr/bin/env tsx
/**
 * audit-all-companies.ts — Rigorous valuation audit across all companies.
 *
 * Loads each company's ZIP, parses Capitaline data, runs pipeline + valuation engine,
 * and reports any NaN, missing, or suspicious results per valuation lens.
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
import { DEFAULT_CONFIG } from "../src/engine/types";

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

const registry: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

const args = {
  limit: null as number | null,
  ticker: null as string | null,
  verbose: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--verbose") args.verbose = true;
  else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1], 10);
  else if (arg.startsWith("--ticker=")) args.ticker = arg.split("=")[1];
  else if (arg === "--help") {
    console.log("Usage: npx tsx scripts/audit-all-companies.ts [--limit=N] [--ticker=TICKER] [--verbose]");
    process.exit(0);
  }
}

let companies = registry;
if (args.ticker) {
  companies = registry.filter((c) => c.ticker === args.ticker || c.folder === args.ticker);
} else if (args.limit) {
  companies = registry.slice(0, args.limit);
}

console.log(`Auditing ${companies.length} companies...`);
console.log("Company                   | Type         | Periods | Stress   | Base     | Bull     | RevDCF   | SOTP     | EPV      | EVEBITDA | Flags");
console.log("-".repeat(150));

interface AuditResult {
  folder: string;
  ticker: string;
  type: string;
  periods: number;
  stress: number | null;
  base: number | null;
  bull: number | null;
  revDcf: number | null;
  sotp: number | null;
  epv: number | null;
  evEbitda: number | null;
  flags: string[];
}

async function auditCompany(company: RegistryEntry): Promise<AuditResult> {
  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);
  const hasZip = existsSync(zipPath);

  if (!hasZip) {
    return {
      folder: company.folder,
      ticker: company.ticker,
      type: company.type,
      periods: 0,
      stress: null,
      base: null,
      bull: null,
      revDcf: null,
      sotp: null,
      epv: null,
      evEbitda: null,
      flags: ["MISSING_ZIP"],
    };
  }

  try {
    const buf = readFileSync(zipPath);
    const file = new File([buf], `${company.folder}.zip`, { type: "application/zip" });

    const parsed = await parseCapitalineZip(file, { companyId: company.folder });
    const config = { ...DEFAULT_CONFIG, company_type: company.type };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const periods = pipeline.periods;

    // Build minimal market context for valuation
    const valuation = buildValuationCommandCenter({
      data: periods,
      config,
      marketData: null,
      analysisStatus: null,
      segmentData: parsed.segmentData || null,
    });

    const scenarios = valuation.scenarios || [];
    const stress = scenarios.find((s) => s.key === "stress")?.intrinsicPerShare ?? null;
    const base = scenarios.find((s) => s.key === "base")?.intrinsicPerShare ?? null;
    const bull = scenarios.find((s) => s.key === "bull")?.intrinsicPerShare ?? null;

    const companyFlags: string[] = [];

    // --- Validation checks ---

    // 1. NaN/Infinity checks
    if (stress !== null && (!Number.isFinite(stress))) companyFlags.push("STRESS_INVALID");
    if (base !== null && (!Number.isFinite(base))) companyFlags.push("BASE_INVALID");
    if (bull !== null && (!Number.isFinite(bull))) companyFlags.push("BULL_INVALID");

    // 2. Ordering: stress <= base <= bull
    if (stress !== null && base !== null && stress > base) companyFlags.push("STRESS_GT_BASE");
    if (base !== null && bull !== null && base > bull) companyFlags.push("BASE_GT_BULL");

    // 3. Negative intrinsic values (usually wrong for profitable companies)
    if (base !== null && base < 0) companyFlags.push("NEGATIVE_BASE");

    // 4. Reverse DCF
    const revDcf = valuation.reverseDcf?.impliedOwnerEarningsGrowth ?? null;
    if (revDcf !== null && !Number.isFinite(revDcf)) companyFlags.push("REVDCF_INVALID");

    // 5. SOTP for conglomerates
    const sotp = valuation.sotp?.totalValue ?? null;
    if (company.type === "conglomerate" && sotp === null) companyFlags.push("CONGLO_NO_SOTP");

    // 6. EPV (Graham-Dodd floor)
    const epv = valuation.epv?.perShare ?? null;
    if (epv !== null && !Number.isFinite(epv)) companyFlags.push("EPV_INVALID");

    // 7. EV/EBITDA
    const evEbitda = valuation.evEbitda?.enterpriseValue ?? null;
    if (evEbitda !== null && !Number.isFinite(evEbitda)) companyFlags.push("EVEBITDA_INVALID");

    // 8. Missing scenarios
    if (!scenarios.length) companyFlags.push("NO_SCENARIOS");

    return {
      folder: company.folder,
      ticker: company.ticker,
      type: company.type,
      periods: periods.length,
      stress,
      base,
      bull,
      revDcf,
      sotp,
      epv,
      evEbitda,
      flags: companyFlags,
    };
  } catch (error: any) {
    return {
      folder: company.folder,
      ticker: company.ticker,
      type: company.type,
      periods: 0,
      stress: null,
      base: null,
      bull: null,
      revDcf: null,
      sotp: null,
      epv: null,
      evEbitda: null,
      flags: [`ERROR: ${error.message}`],
    };
  }
}

// Process sequentially to avoid OOM
async function run() {
  const results: AuditResult[] = [];
  for (const company of companies) {
    const result = await auditCompany(company);
    results.push(result);
    const flagStr = result.flags.length ? result.flags.join(",") : "OK";
    console.log(
      `${result.folder.padEnd(25)} | ${result.type.padEnd(12)} | ${String(result.periods).padStart(3)} | ` +
      `${result.stress !== null ? result.stress.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.base !== null ? result.base.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.bull !== null ? result.bull.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.revDcf !== null ? result.revDcf.toFixed(4).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.sotp !== null ? result.sotp.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.epv !== null ? result.epv.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${result.evEbitda !== null ? result.evEbitda.toFixed(2).padStart(8) : "N/A".padStart(8)} | ` +
      `${flagStr}`
    );
  }

  // Summary
  const errorResults = results.filter((r) => r.flags.length);
  const okResults = results.filter((r) => !r.flags.length);

  console.log("\n" + "=".repeat(150));
  console.log(`AUDIT SUMMARY: ${okResults.length}/${results.length} clean`);
  if (errorResults.length) {
    console.log(`\nFLAGGED (${errorResults.length}):`);
    for (const r of errorResults) {
      console.log(`  ${r.folder} (${r.ticker}): ${r.flags.join(", ")}`);
    }
  }
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
