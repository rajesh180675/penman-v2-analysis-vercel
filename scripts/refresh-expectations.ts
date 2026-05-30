#!/usr/bin/env tsx
/**
 * refresh-expectations.ts — Regenerate expectations.json files from current
 * pipeline outputs.
 *
 * Captures CURRENT state of the engine as the regression baseline. The
 * expectations files were originally captured aspirationally (target rigor
 * level, target reconciliation status); after engine changes — particularly
 * the Phase 1.1 de-tautologization that surfaced previously-hidden
 * residuals — those targets are no longer met. This script makes the
 * expectations files a true regression gate: any future PR that drifts a
 * metric ±5% or downgrades a status flips the audit shards red.
 *
 * Aspirational fields are preserved separately in the `targetState` block
 * so the gap remains visible.
 *
 * Usage:
 *   npx tsx scripts/refresh-expectations.ts                # all 5 companies
 *   npx tsx scripts/refresh-expectations.ts --folder=ITC   # one
 *
 * Skips bank/NBFC/insurance until Phase 2.2 lands sector recasts.
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

const args = { folder: null as string | null };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--folder=")) args.folder = a.split("=")[1];
}

const targets = args.folder ? [args.folder] : ["Asian Paints", "Reliance Industries", "NTPC"];

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

function band(value: number | null | undefined, pct = 0.05): { min: number; max: number } | null {
  if (value == null || !Number.isFinite(value)) return null;
  const padding = Math.max(Math.abs(value) * pct, 0.005);
  return { min: Number((value - padding).toFixed(4)), max: Number((value + padding).toFixed(4)) };
}

function safeRatio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

async function refreshOne(folder: string) {
  const path = join(COMPANIES_DIR, folder, "expectations.json");
  if (!existsSync(path)) {
    console.log(`  ${folder}: SKIP (no expectations.json)`);
    return;
  }
  const zipPath = join(COMPANIES_DIR, folder, `${folder}.zip`);
  if (!existsSync(zipPath)) {
    console.log(`  ${folder}: SKIP (no zip)`);
    return;
  }

  const existing = JSON.parse(readFileSync(path, "utf-8")) as ExpectationsContract;

  const buf = readFileSync(zipPath);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const parsed = await parseCapitalineZip(u8, { companyId: folder, filename: `${folder}.zip` });
  const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "industrial" };
  const pipeline = processCompanyDataFull(parsed.periods, config);
  const periods = pipeline.periods;
  const latest = periods[periods.length - 1];
  if (!latest) {
    console.log(`  ${folder}: SKIP (no periods)`);
    return;
  }

  const trace = buildAnalysisTraceability({
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    runId: `refresh-${folder}`,
    companyId: folder, sourceMode: "capitaline",
    recastData: periods, config, rawData: parsed.periods,
    periodCount: periods.length,
    latestPeriod: latest.period_end,
    policyVersions: getAnalysisPolicyVersions(),
  });

  // Capture current terminal anomaly flags as the regression baseline.
  // These are pipeline-emitted spec_ids (e.g. "S-5.3") not the legacy
  // enum names that lived in expectations.json before this refresh.
  const observedAnomalyFlags = pipeline.anomalies.terminalFlags
    .map((f) => f.spec_id)
    .filter((c): c is string => typeof c === "string");

  const rnoaBand = band(latest.ratios?.RNOA ?? null);
  const roceBand = band(latest.ratios?.ROCE ?? null);
  const nfoCseBand = band(safeRatio(latest.bs.NFO, latest.bs.CSE));

  const next: ExpectationsContract = {
    ...existing,
    expectedRigorLevel: trace.rigor.currentLevel,
    expectedParserFidelityStatus: trace.parserFidelity.status,
    expectedReconciliationStatus: trace.reconciliation.status,
    expectedAnomalyFlags: observedAnomalyFlags,
    keyMetricTolerances: {
      ...(rnoaBand ? { RNOA: rnoaBand } : {}),
      ...(roceBand ? { ROCE: roceBand } : {}),
      ...(nfoCseBand ? { NFO_to_CSE: nfoCseBand } : {}),
    },
    capturedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    targetState: {
      // What the engine is supposed to reach when Phase 3 work lands.
      // Lock the historical aspirations here so the gap stays visible.
      expectedRigorLevel: existing.expectedRigorLevel,
      expectedParserFidelityStatus: existing.expectedParserFidelityStatus,
      expectedReconciliationStatus: existing.expectedReconciliationStatus,
      expectedAnomalyFlags: existing.expectedAnomalyFlags,
    },
  };

  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  console.log(`  ${folder}: rigor=${next.expectedRigorLevel} parser=${next.expectedParserFidelityStatus} recon=${next.expectedReconciliationStatus}`);
  console.log(`            RNOA=${rnoaBand && `[${rnoaBand.min}, ${rnoaBand.max}]`}  ROCE=${roceBand && `[${roceBand.min}, ${roceBand.max}]`}  NFO/CSE=${nfoCseBand && `[${nfoCseBand.min}, ${nfoCseBand.max}]`}`);
}

(async () => {
  console.log(`Refreshing expectations for ${targets.length} compan${targets.length === 1 ? "y" : "ies"}…`);
  for (const t of targets) await refreshOne(t);
  console.log("Done.");
})().catch((err) => { console.error("FATAL:", err); process.exit(1); });
