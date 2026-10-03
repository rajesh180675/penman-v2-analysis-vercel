#!/usr/bin/env tsx
/**
 * diagnose-company.ts — why a library company lands where it does.
 *
 * Runs the company through the same loader the app uses, then prints the rung
 * it reached, why the next one is withheld, every reconciliation check that
 * did not confirm — each with the raw Capitaline lines that could explain its
 * residual — and the terminal-year flags. For a company just added with
 * `node sync-companies.cjs`, this is the first thing to run.
 *
 * Usage:
 *   npm run diagnose -- TCS
 *   npm run diagnose -- "Nestlé India"
 *
 * Reads the library on disk and writes nothing. No market price is fetched.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeLegacyAnalysisRun } from "../src/engine/analysisRun";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { fetchBankQualityIndicators } from "../src/engine/bankQualityIndicators";
import type { RecastPeriod } from "../src/engine/types";
import type { LibraryCompany } from "../src/components/data-entry/companyRegistry";
import { loadCompanyRun, type CompanyRunDependencies } from "../src/next/companyRun";
import { findResidualCandidates, type CandidateStatement } from "./lib/residualCandidates";

const COMPANIES_DIR = join(resolve(fileURLToPath(new URL(".", import.meta.url)), ".."), "public", "data", "companies");

/** Checks whose residual a raw P&L or cash-flow line can explain, and those a balance-sheet line can. */
const INCOME_CHECKS = new Set(["operating-cost-bridge", "comprehensive-income-bridge"]);
const BALANCE_CHECKS = new Set(["ol-coverage-bridge", "recast-ta-vs-raw", "recast-equity-side-vs-raw", "external-equity-bridge"]);
const MAX_CHECKS_SHOWN = 10;

function loadRegistry(): LibraryCompany[] {
  const parsed = JSON.parse(readFileSync(join(COMPANIES_DIR, "registry.json"), "utf-8")) as LibraryCompany[] | { companies: LibraryCompany[] };
  return Array.isArray(parsed) ? parsed : parsed.companies;
}

function readLabels(period: RecastPeriod | undefined): Set<string> {
  const labels = new Set<string>();
  for (const entries of Object.values(period?.trace ?? {})) {
    for (const entry of entries) if (entry.matchType !== "derived") labels.add(entry.key);
  }
  return labels;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const year = (periodEnd: string) => periodEnd.slice(0, 4);

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const registry = loadRegistry();
  if (!arg) {
    console.error('Usage: npm run diagnose -- <ticker or folder>\nKnown: ' + registry.map((c) => c.ticker).join(" "));
    process.exit(1);
  }
  const company = registry.find((c) => c.ticker.toLowerCase() === arg.toLowerCase() || c.folder.toLowerCase() === arg.toLowerCase());
  if (!company) {
    console.error(`"${arg}" is not in the registry. Add its folder under public/data/companies/ and run: node sync-companies.cjs\nKnown: ` + registry.map((c) => c.ticker).join(" "));
    process.exit(1);
  }

  const deps: CompanyRunDependencies = {
    fetchZip: async (url) => {
      const file = join(COMPANIES_DIR, company.folder, url.endsWith("/standalone.zip") ? "standalone.zip" : `${company.folder}.zip`);
      const buf = readFileSync(file);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    parse: async (bytes, id) => {
      const { periods, debug } = await parseCapitalineZip(bytes, { companyId: id });
      return { periods, debug };
    },
    fetchMarketSnapshot: async () => null,
    run: (input) => executeLegacyAnalysisRun(input),
    now: () => new Date(),
    // The sidecar the app loads, read from disk through the same parser.
    fetchBankQuality: async (c) => {
      if (c.type !== "bank" && c.type !== "nbfc" && c.type !== "insurance") return null;
      const file = join(COMPANIES_DIR, c.folder, "quality_indicators.json");
      return fetchBankQualityIndicators(c.folder, async () =>
        // The loader rejects a non-JSON content type (Vite's SPA fallback serves
        // HTML for a missing file), so a disk read must declare it.
        existsSync(file)
          ? new Response(readFileSync(file), { headers: { "content-type": "application/json" } })
          : new Response(null, { status: 404 }));
    },
  };

  const state = await loadCompanyRun(company, undefined, deps);
  if (state.status === "error") {
    console.error(`${company.name}: ${state.message}\nIf the files are new, run: node sync-companies.cjs`);
    process.exit(1);
  }
  const { result } = state;
  const env = result.run?.trustEnvelope;
  const m = result.materialization;
  const recast = (m.pipelineResult?.periods ?? []) as readonly RecastPeriod[];
  const raw = m.rawData;
  if (!env) {
    console.log(`${company.name}: the run produced no trust envelope (${result.status}).`);
    return;
  }

  console.log(`== ${company.name} (${company.ticker}) - ${company.type} - ${state.basis ?? "consolidated"} accounts`);
  console.log(`   ${raw.length} periods ${raw[0]?.period_end ?? "?"} .. ${raw.at(-1)?.period_end ?? "?"}; run ${result.status}${"reasonCode" in result ? ` (${result.reasonCode})` : ""}; no market price`);

  console.log(`\nRung: ${env.rigor.currentLevel}`);
  const held = env.rigor.checkpoints.find((c) => !c.achieved);
  console.log("   " + env.rigor.checkpoints.map((c) => `${c.achieved ? "[x]" : "[ ]"} ${c.level}`).join("  "));
  if (held) console.log(`   held at ${held.level}: ${clip(held.detail, 600)}`);

  const gating = env.reconciliation.checks.filter((c) => c.role !== "diagnostic");
  const open = gating.filter((c) => c.status !== "confirmed").sort((a, b) => b.ratio - a.ratio);
  console.log(`\nReconciliation: ${env.reconciliation.status} - ${gating.length} gating checks, ${open.filter((c) => c.status === "failed").length} failed, ${open.filter((c) => c.status === "degraded").length} degraded`);
  for (const check of open.slice(0, MAX_CHECKS_SHOWN)) {
    console.log(`   ${check.key} ${year(check.periodEnd)} ${check.status} ratio ${check.ratio.toFixed(3)} residual ${check.residual.toFixed(2)}`);
    const statements: CandidateStatement[] | null = INCOME_CHECKS.has(check.key) ? ["ProfitLoss", "CashFlow"] : BALANCE_CHECKS.has(check.key) ? ["BalanceSheet"] : null;
    const rawPeriod = raw.find((p) => p.period_end === check.periodEnd);
    const recastPeriod = recast.find((p) => p.period_end === check.periodEnd);
    if (!statements || !rawPeriod) {
      console.log(`      ${clip(check.detail, 200)}`);
      continue;
    }
    const candidates = findResidualCandidates({
      rawValues: rawPeriod.raw_metric_values,
      readLabels: readLabels(recastPeriod),
      residual: check.residual,
      taxRate: recastPeriod?.is.taxRate ?? 0,
      statements,
    });
    if (candidates.length === 0) console.log("      no single raw line equals the residual: look for a combination of lines");
    for (const c of candidates) {
      const note = c.read ? "was read: check its sign, its scale, or a double count" : "was not traced as read: unmapped, or read without a trace";
      console.log(`      -> "${c.label}" = ${c.value} (${c.statement}, ${c.basis}) equals the residual and ${note}`);
    }
  }
  if (open.length > MAX_CHECKS_SHOWN) console.log(`   ... and ${open.length - MAX_CHECKS_SHOWN} more`);

  if (recast.length > 0) {
    const latest = recast.at(-1);
    const flags = (latest?.spec_flags ?? []).filter((f) => f.affects_terminal);
    const blocked = env.unusualItemManifest?.terminalEligibilityBlocked;
    console.log(`
Terminal year ${latest?.period_end ?? "?"}: ${blocked || flags.length ? "BLOCKED" : "clean"}${flags.length ? ` - ${flags.map((f) => f.label).join(", ")}` : ""}${blocked && !flags.length ? " - by unusual items" : ""}`);
  }

  // Banks, NBFCs and insurers are valued by the financial-institution pipeline,
  // not the industrial command center, which refuses their family by design.
  const bank = m.pipelineResult?.bankResult;
  if (bank) {
    const card = (bank.valuation?.scenarios?.cards ?? []).find((c) => c.key === "base");
    const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
    const shown = finite(card?.intrinsicPerShare)
      ? `base INR ${Math.round(card.intrinsicPerShare)}/share`
      : finite(card?.intrinsicValue) ? `base equity value INR ${Math.round(card.intrinsicValue)} Cr (no per-share figure)` : "none";
    console.log(`Financial-institution valuation (${bank.subtype}): ${shown}`);
    return;
  }
  const base = m.commandCenter?.scenarios.find((s) => s.key === "base");
  if (base) {
    const kc = base.kwConsistency;
    console.log(`Base case: ${base.intrinsicPerShare == null ? "none" : `INR ${Math.round(base.intrinsicPerShare)}/share`}; kw ${(base.assumptions.kw * 100).toFixed(1)}%${kc ? ` (${kc.method})` : ""}`);
  } else {
    console.log("Base case: none (valuation withheld)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
