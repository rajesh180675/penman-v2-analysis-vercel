#!/usr/bin/env tsx
/**
 * audit-baseline.ts — Capture per-company audit baseline for cross-phase regression diffing.
 *
 * Reuses the audit-all-companies pipeline + valuation path, enriches with the
 * traceability envelope (rigor level, parser fidelity, reconciliation status,
 * reconciliation max ratio) so post-Phase-1 changes show up in diffs.
 *
 * Usage:
 *   npx tsx scripts/audit-baseline.ts --label=phase1
 *   npx tsx scripts/audit-baseline.ts --label=phase2 --ticker=ITC   # spot-check
 *
 * Output: audit-baselines/<label>.json
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { processCompanyDataFull } from "../src/engine/pipeline";
import { buildValuationCommandCenter } from "../src/engine/valuationCommandCenter";
import { buildAnalysisTraceability } from "../src/engine/analysisTraceability";
import { getAnalysisPolicyVersions } from "../src/engine/policyVersions";
import { DEFAULT_CONFIG } from "../src/engine/types";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const COMPANIES_DIR = join(PROJECT_ROOT, "public", "data", "companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const BASELINES_DIR = join(PROJECT_ROOT, "audit-baselines");

interface RegistryEntry {
  folder: string;
  name: string;
  ticker: string;
  type: string;
}

interface BaselineEntry {
  folder: string;
  ticker: string;
  type: string;
  family?: "industrial" | "financial-institution";
  periods: number;
  latestPeriod: string | null;
  valuation: {
    stress: number | null;
    base: number | null;
    bull: number | null;
    revDcfGrowth: number | null;
    sotpTotal: number | null;
    epvPerShare: number | null;
    evEbitdaEv: number | null;
  };
  // Phase 2.2 — bank/NBFC/insurance valuation lives separately. Captured
  // for diff visibility; null for industrial companies.
  bankValuation?: {
    subtype: string | null;
    fairPB: number | null;
    fairValue: number | null;
    upsidePct: number | null;
    primaryScenario: string | null;
  };
  rigor: {
    currentLevel: string | null;
    parserFidelityStatus: string | null;
    parserFidelityScore: number | null;
    reconciliationStatus: string | null;
    reconciliationMaxRatio: number | null;
    confidenceStatus: string | null;
  };
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
  else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1], 10);
}
if (!args.label) {
  console.error("ERROR: --label=<name> is required (e.g. --label=phase1)");
  process.exit(2);
}

const registry: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
let companies = registry;
if (args.ticker) companies = registry.filter((c) => c.ticker === args.ticker || c.folder === args.ticker);
else if (args.limit) companies = registry.slice(0, args.limit);

async function captureCompany(company: RegistryEntry): Promise<BaselineEntry> {
  const empty: BaselineEntry = {
    folder: company.folder, ticker: company.ticker, type: company.type,
    periods: 0, latestPeriod: null,
    valuation: { stress: null, base: null, bull: null, revDcfGrowth: null, sotpTotal: null, epvPerShare: null, evEbitdaEv: null },
    rigor: { currentLevel: null, parserFidelityStatus: null, parserFidelityScore: null, reconciliationStatus: null, reconciliationMaxRatio: null, confidenceStatus: null },
    flags: [],
  };
  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);
  if (!existsSync(zipPath)) return { ...empty, flags: ["MISSING_ZIP"] };

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config = { ...DEFAULT_CONFIG, company_type: company.type as never };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const family = pipeline.analysisFamily;
    const periods = pipeline.periods;

    const trace = buildAnalysisTraceability({
      generatedAt: "2026-05-29T00:00:00.000Z",
      runId: `baseline-${company.folder}`,
      companyId: company.folder,
      sourceMode: "capitaline",
      recastData: periods,
      config,
      rawData: parsed.periods,
      periodCount: periods.length,
      latestPeriod: periods[periods.length - 1]?.period_end ?? null,
      policyVersions: getAnalysisPolicyVersions(),
    });

    const rigor = {
      currentLevel: trace.rigor.currentLevel,
      parserFidelityStatus: trace.parserFidelity.status,
      parserFidelityScore: trace.parserFidelity.score,
      reconciliationStatus: trace.reconciliation.status,
      reconciliationMaxRatio: trace.reconciliation.maxResidualRatio,
      confidenceStatus: trace.confidence.status,
    };

    if (family === "financial-institution") {
      // Banks/NBFCs/insurance — valuation is on bankResult.valuation.
      const bm = pipeline.bankResult?.bankMetrics ?? [];
      const bv = pipeline.bankResult?.valuation ?? null;
      const cards = bv?.scenarios?.cards ?? [];
      const primaryKey = bv?.scenarios?.primary ?? "base";
      const primary = cards.find((c) => c.key === primaryKey)
        ?? cards.find((c) => c.key === "base")
        ?? cards[0]
        ?? null;
      return {
        folder: company.folder, ticker: company.ticker, type: company.type,
        family,
        periods: bm.length,
        latestPeriod: bm[bm.length - 1]?.period_end ?? null,
        valuation: empty.valuation, // industrial-shape; null for financial
        bankValuation: {
          subtype: pipeline.bankResult?.subtype ?? null,
          fairPB: primary?.fairPB ?? null,
          fairValue: primary?.intrinsicValue ?? null,
          upsidePct: primary?.upsidePct ?? null,
          primaryScenario: primaryKey,
        },
        rigor,
        flags: [],
      };
    }

    // Industrial path
    const valuation = buildValuationCommandCenter({
      data: periods, config, marketData: null, analysisStatus: null,
      segmentData: parsed.segmentData || null,
    } as never) as never as Record<string, unknown> & {
      scenarios?: Array<{ key: string; intrinsicPerShare: number | null }>;
      reverseDcf?: { impliedOwnerEarningsGrowth: number | null };
      sotp?: { totalValue: number | null };
      epv?: { perShare: number | null };
      evEbitda?: { enterpriseValue: number | null };
    };
    const scenarios = valuation.scenarios ?? [];
    const stress = scenarios.find((s) => s.key === "stress")?.intrinsicPerShare ?? null;
    const base = scenarios.find((s) => s.key === "base")?.intrinsicPerShare ?? null;
    const bull = scenarios.find((s) => s.key === "bull")?.intrinsicPerShare ?? null;

    const flags: string[] = [];
    if (stress !== null && !Number.isFinite(stress)) flags.push("STRESS_INVALID");
    if (base !== null && !Number.isFinite(base)) flags.push("BASE_INVALID");
    if (bull !== null && !Number.isFinite(bull)) flags.push("BULL_INVALID");
    if (stress !== null && base !== null && stress > base) flags.push("STRESS_GT_BASE");
    if (base !== null && bull !== null && base > bull) flags.push("BASE_GT_BULL");
    if (base !== null && base < 0) flags.push("NEGATIVE_BASE");

    return {
      folder: company.folder, ticker: company.ticker, type: company.type,
      family,
      periods: periods.length,
      latestPeriod: periods[periods.length - 1]?.period_end ?? null,
      valuation: {
        stress, base, bull,
        revDcfGrowth: valuation.reverseDcf?.impliedOwnerEarningsGrowth ?? null,
        sotpTotal: valuation.sotp?.totalValue ?? null,
        epvPerShare: valuation.epv?.perShare ?? null,
        evEbitdaEv: valuation.evEbitda?.enterpriseValue ?? null,
      },
      rigor,
      flags,
    };
  } catch (err) {
    return { ...empty, flags: [`ERROR`], error: (err as Error).message };
  }
}

async function run() {
  console.log(`Capturing baseline "${args.label}" for ${companies.length} companies…`);
  const out: BaselineEntry[] = [];
  for (const company of companies) {
    process.stdout.write(`  ${company.folder.padEnd(35)} `);
    const entry = await captureCompany(company);
    out.push(entry);
    console.log(entry.flags.length ? `FLAGGED (${entry.flags.join(",")})` : `OK ${entry.rigor.currentLevel ?? "?"}`);
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
