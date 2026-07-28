/* ================================================================
   Pack activation — that every capital-cost call site is accounted for.

   Most assertions here read source text rather than call a function.
   That is deliberate, and it is because of how a pack reaches the
   resolver: as an argument, never a default.

   `resolveCostOfCapitalFromConfig({ config })` returns the *unpinned*
   rate — the same undated `rf + sectorBeta × erp` it always did — and it
   does so silently, with no error and no tier a caller would notice was
   wrong. So the failure activation has to prevent is not "the pack is
   wrong". It is "a call site forgot the pack", which yields two
   different discount rates for one run: the number the app prints and
   the number the run recorded. That is the S-9.4C violation, and no
   behavioural test of the resolver can see it, because the resolver
   behaved correctly both times.

   What can see it is the set of call sites, so the census below owns
   that set. Every module that resolves a capital cost must be in
   exactly one of three lists, and the last test derives the real set
   from the tree so a new one cannot appear unlisted.
================================================================ */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../activePacks";
import { INDIA_EQUITY_BETA_PACK } from "../indiaEquityBetaPack";
import { INDIA_MACRO_PACK } from "../indiaMacroPack";
import { resolveMacroPack } from "../macroPack";
import { resolveEquityBeta } from "../equityBetaPack";
import { resolveCostOfCapitalFromConfig } from "../../costOfCapital";
import { DEFAULT_CONFIG, type EngineConfig } from "../../types";

/**
 * Supplies the packs: everything whose resolved rate a reviewer reads, or
 * that records one. These must name `ACTIVE_MARKET_PACKS`.
 */
const SUPPLIES_PACKS = [
  "src/app/analysisRun/useAnalysisRunExecution.ts",
  "src/app/useAuditAnalysis.ts",
  "src/components/dashboard/DashboardView.tsx",
  "src/components/ValuationReport.tsx",
  "src/components/ComparisonReport.tsx",
  "src/components/ForecastReport.tsx",
  "src/components/V3AnalyticsPanel.tsx",
  "src/components/AcademicReport.tsx",
  "src/components/InvestmentThesis.tsx",
];

/**
 * Takes the packs from its caller. These must NOT name
 * `ACTIVE_MARKET_PACKS`: importing it would make a spec that calls one of
 * these directly resolve production packs, which is exactly the
 * supplied-never-inferred contract the resolver's testability rests on.
 */
const PASSES_PACKS_THROUGH = [
  "src/engine/valuationCommandCenter/core.ts",
  "src/engine/analysisCase/assumptionResolution.ts",
  "src/engine/grahamDoddEPV.ts",
  "src/engine/v3Analytics/compute.ts",
];

/**
 * Deliberately still unpinned, each for a stated reason. Listed rather
 * than skipped so the exemption is a decision on the record instead of an
 * omission — and so the list can be worked down.
 */
const KNOWN_UNPINNED: ReadonlyArray<readonly [string, string]> = [
  // Recast layer. Its ke feeds `ri.RE` and the anomaly series, not a
  // discount rate — and `processCompanyDataFull` is the entry point the CLI
  // audit harness and refresh-expectations.ts share, so pinning it moves the
  // captured baselines for all 33 companies. Separate change, with a
  // baseline re-capture.
  ["src/engine/pipeline.ts", "recast RI; shared with the baseline harness"],
  // Bank/NBFC family, reached only through `pipeline.ts` above. Pinning
  // these without it would fork the same recast two ways.
  ["src/engine/bankValuation/computeBankValuation.ts", "downstream of pipeline.ts"],
  ["src/engine/financialInstitutionFramework.ts", "downstream of pipeline.ts"],
  ["src/engine/moatScoring/bank.ts", "downstream of pipeline.ts"],
  ["src/engine/capitalAllocationScoring/bank.ts", "downstream of pipeline.ts"],
  // Workbook cover sheets. They print a ke for the reader, so these are a
  // real gap — but both are export-time renderers with no pack in scope,
  // and threading them means changing the export entry signatures.
  ["src/engine/bankExcelExport.ts", "export renderer; no pack in scope"],
  ["src/engine/excelExport/sheetsCore.ts", "export renderer; no pack in scope"],
  // Regression and guardrail harnesses. These compare the engine against
  // itself, so an undated rate on both sides of the comparison is the
  // point; a pinned rate that lapses would move the benchmark.
  ["src/engine/baselineGuardrails.ts", "self-comparison; undated on both sides"],
  ["src/engine/regressionHarness.ts", "self-comparison; undated on both sides"],
  // The CLI audit harness, and the exemption worth understanding rather than
  // scanning past. It pins `generatedAt` to 2026-06-04 so 33 company audits
  // reproduce byte-for-byte, and it passes no `analysisAsOf` at all. Both facts
  // matter, and neither makes activation here a one-line change:
  //
  //   - Handing it the packs *without* an as-of date is the worse option, not
  //     the easy one: `resolveMacroObservation` skips staleness AND look-ahead
  //     entirely when the date is falsy, so the harness would honour these
  //     observations forever, including long after they lapse.
  //   - Handing it the packs *with* its own pinned date splits them. The
  //     risk-free rate (2026-07-24) and every beta window (ending 2026-07-19)
  //     postdate 2026-06-04, so they resolve as look-ahead and `unusable` — a
  //     pinned run cannot consume observations from its own future. The ERP
  //     (2026-01-05) predates it and would resolve `sourced`. That leaves ke
  //     part-sourced and part-prior, which `CoreBuildContext.betaPack` warns
  //     against by name: pass both or neither.
  //
  // The consequence today is real and not hidden: the harness scores the
  // assumption-provenance gate on undated priors while the app scores it on
  // sourced observations, so the two disagree about production-readiness.
  // Closing it means a pack vintage matched to the harness's own as-of, not
  // today's pack and not today's clock.
  ["scripts/lib/auditCompanyRun.ts", "pinned as-of predates two of three observations"],
];

function source(path: string): string {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf-8");
}

describe("pack activation — the packs themselves", () => {
  it("names the two shipped packs", () => {
    // Identity, not shape: a copy would satisfy a shape check while drifting
    // from the pack the CI freshness gate actually measures.
    expect(ACTIVE_MARKET_PACKS.macroPack).toBe(INDIA_MACRO_PACK);
    expect(ACTIVE_MARKET_PACKS.betaPack).toBe(INDIA_EQUITY_BETA_PACK);
  });

  it("resolves today's date in the format the staleness checks parse", () => {
    const asOf = analysisAsOfToday();
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The mechanism keys off this being real wall-clock rather than a pinned
    // constant, which would make the packs look permanently fresh. So assert
    // it agrees with the clock, not with a literal.
    expect(asOf).toBe(new Date().toISOString().slice(0, 10));
  });

  it("earns sourced macro tiers at today's date", () => {
    // The claim activation actually makes, and it is time-dependent: it holds
    // while the pinned observations are inside their windows.
    // `npm run lint:pack-freshness` fails in CI before they lapse, so this
    // failing means that gate was ignored, not that the test is brittle.
    const resolution = resolveMacroPack(ACTIVE_MARKET_PACKS.macroPack, analysisAsOfToday());
    expect(resolution.riskFreeRate.status).toBe("usable");
    expect(resolution.equityRiskPremium.status).toBe("usable");
  });

  it("resolves a regressed beta for a registry ticker at today's date", () => {
    const beta = resolveEquityBeta(ACTIVE_MARKET_PACKS.betaPack, "TCS", {
      analysisAsOf: analysisAsOfToday(),
    });
    expect(beta.status).toBe("usable");
  });

  it("moves ke away from the unpinned derivation", () => {
    // Non-vacuity for the census: if supplying the packs changed nothing,
    // every "must supply the packs" assertion would assert nothing.
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services", ticker: "TCS" };
    const pinned = resolveCostOfCapitalFromConfig({
      config,
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    }).ke;
    const unpinned = resolveCostOfCapitalFromConfig({ config }).ke;
    expect(Math.abs(pinned - unpinned)).toBeGreaterThan(0.001);
  });

  it("falls back to the sector prior for an issuer outside the pack", () => {
    // A manual upload gets an arbitrary company id, so this is reachable and
    // has to degrade rather than throw.
    const config: EngineConfig = { ...DEFAULT_CONFIG, ticker: "NOT-IN-PACK" };
    const result = resolveCostOfCapitalFromConfig({
      config,
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    });
    expect(result.assumptions?.beta.tier).toBe("prior");
    // rf and ERP still come from the pack, so one missing constituent does not
    // throw the run back to fully undated inputs.
    expect(result.assumptions?.riskFreeRate.tier).toBe("sourced");
  });
});

describe("pack activation — the call-site census", () => {
  it.each(SUPPLIES_PACKS)("%s supplies the active packs", (path) => {
    expect(source(path)).toContain("ACTIVE_MARKET_PACKS");
  });

  it.each(PASSES_PACKS_THROUGH)("%s takes packs from its caller", (path) => {
    const text = source(path);
    // Accepts them...
    expect(text).toMatch(/SuppliedMarketPacks|macroPack/);
    // ...and does not reach for the production set itself.
    expect(text).not.toContain("ACTIVE_MARKET_PACKS");
  });

  it.each(KNOWN_UNPINNED)("%s is a recorded exemption (%s)", (path) => {
    // Asserted so a fixed exemption cannot sit here looking unfixed: once one
    // of these starts supplying packs, move it to SUPPLIES_PACKS.
    expect(source(path)).not.toContain("ACTIVE_MARKET_PACKS");
  });

  it("finds no capital-cost resolution outside the three lists", () => {
    // Derived from the tree rather than trusting the lists above to be
    // current. Test files are excluded: a spec asserting the pack-less
    // behaviour is the contract working, not a call site that forgot.
    const RESOLVERS = /resolveCostOfCapitalFromConfig\(|buildValuationCommandCenter\(|computeEPV\(|computeV3Analytics\(/;
    const accounted = new Set<string>([
      ...SUPPLIES_PACKS,
      ...PASSES_PACKS_THROUGH,
      ...KNOWN_UNPINNED.map(([path]) => path),
      // The resolver and the activation seam define the things being matched.
      "src/engine/costOfCapital/resolver.ts",
      "src/engine/marketPacks/activePacks.ts",
    ]);

    const unaccounted: string[] = [];
    // `scripts` is in scope deliberately: the CLI audit harness resolves a
    // capital cost and reports a rigor level from it, and an earlier draft of
    // this census walked only `src`, which is exactly why that file went
    // unnoticed. A guard that cannot see a call site is not a guard.
    for (const root of ["src/app", "src/components", "src/engine", "scripts"]) {
      for (const file of walk(root)) {
        if (/__tests__|\.spec\.|\.test\./.test(file)) continue;
        if (accounted.has(file)) continue;
        if (RESOLVERS.test(source(file))) unaccounted.push(file);
      }
    }

    // Named rather than counted: the failure has to say which file, so the
    // reviewer can decide which of the three lists it belongs in.
    expect(unaccounted).toEqual([]);
  });
});

/** Depth-first walk of a repo-relative directory, returning repo-relative paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(`../../../../${dir}`, import.meta.url), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(next));
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}
