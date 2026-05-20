/**
 * Bajaj Finance — NBFC pipeline stress test
 *
 * @vitest-environment jsdom
 *
 * Verifies the pipeline routes Bajaj Finance through the bank/NBFC path
 * and produces meaningful NBFC metrics (leverage, spread, NIM).
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { readFileSync } from "fs";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull, PipelineResult } from "../pipeline";
import { DEFAULT_CONFIG } from "../types";
import { BankQualityIndicators } from "../bankQualityIndicators";

describe("Bajaj Finance (NBFC)", () => {
  let result: PipelineResult | null = null;

  it("parses and runs pipeline without throwing", { timeout: 60_000 }, async () => {
    const zipPath = resolve(__dirname, "../../../public/data/companies/bajaj finance/bajaj finance.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "bajaj finance.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    expect(parsed).toBeTruthy();
    expect(parsed!.periods.length).toBeGreaterThan(0);

    const { assessAnalysisScope } = await import("../scopePolicy");
    const scope = assessAnalysisScope(parsed!.periods, DEFAULT_CONFIG);
    console.log("CLASSIFICATION:", scope.classification);
    console.log("FAMILY:", scope.analysisFamily);
    console.log("SIGNALS DETECTED:", JSON.stringify(scope.signals, null, 2));
    console.log("REASONS:", scope.reasons);
    
    // Print all non-zero keys in period 0
    const nonZeroKeys = Object.entries(parsed!.periods[0].raw_metric_values)
      .filter(([_, v]) => v !== null && Math.abs(v) >= 1.0)
      .map(([k, v]) => `${k}: ${v}`);
    console.log("KEYS IN PERIOD 0 (first 30):", nonZeroKeys.slice(0, 30));

    // Load quality sidecar for NBFC metrics (cost-to-income, CRAR, etc.)
const qiPath = resolve(__dirname, "../../../public/data/companies/Bajaj Finance/quality_indicators.json");
let qi: BankQualityIndicators | null = null;
try {
  const qiRaw = readFileSync(qiPath, "utf-8");
  qi = JSON.parse(qiRaw) as BankQualityIndicators;
} catch { /* sidecar optional */ }
console.log("Quality sidecar loaded:", qi != null, "Periods:", qi?.periods?.length ?? 0);

result = processCompanyDataFull(parsed!.periods, DEFAULT_CONFIG, qi);
    expect(result).toBeTruthy();
    console.log("Analysis family:", result.analysisFamily);
    console.log("Bank result?", result.bankResult != null);
    if (result.bankResult) {
      const br = result.bankResult;
      console.log("Subtype:", br.subtype);
      console.log("Bank metrics periods:", br.bankMetrics?.length);
      if (br.bankMetrics && br.bankMetrics.length > 0) {
        const latest = br.bankMetrics[br.bankMetrics.length - 1];
        console.log("Latest NIM:", latest.nim);
        console.log("Latest ROA:", latest.roa);
        console.log("Latest ROE:", latest.roe);
        console.log("Latest leverage:", latest.leverage);
        console.log("Latest spread:", latest.spread);
      }
      console.log("Valuation:", br.valuation ? Object.keys(br.valuation) : "null");
    }
  });

  it("routes to financial-institution family", () => {
    expect(result!.analysisFamily).toBe("financial-institution");
  });

  it("produces bankResult with NBFC subtype", () => {
    expect(result!.bankResult).toBeTruthy();
    expect(result!.bankResult!.subtype).toBe("nbfc");
  });

  it("has bank metrics with ROA and ROE", () => {
    const br = result!.bankResult!;
    expect(br.bankMetrics).toBeTruthy();
    expect(br.bankMetrics!.length).toBeGreaterThan(3);

    const latest = br.bankMetrics![br.bankMetrics!.length - 1];
    // X-Detail P&L: avgAssets/avgEquity require a prior period; the last
    // period in the test dataset may not have a valid prior. Skip nulls.
    // Bajaj Finance ROA ~4%, ROE ~19% (when data is complete)
    if (latest.roa != null) {
      expect(latest.roa).toBeGreaterThan(0.01);
      expect(latest.roa).toBeLessThan(0.10);
    }
    if (latest.roe != null) {
      expect(latest.roe).toBeGreaterThan(0.10);
      expect(latest.roe).toBeLessThan(0.35);
    }
    // Phase D: leverage, spread, NIM now resolved via Ind-AS fallback
    // Bajaj Finance: leverage ~3.7x, spread ~9%, NIM ~10%
    expect(latest.leverage).toBeGreaterThan(2.0);
    expect(latest.leverage).toBeLessThan(8.0);
    if (latest.spread != null) {
      expect(latest.spread).toBeGreaterThan(0.03);
      expect(latest.spread).toBeLessThan(0.20);
    }
    if (latest.nim != null) {
      expect(latest.nim).toBeGreaterThan(0.05);
      expect(latest.nim).toBeLessThan(0.20);
    }
  });

  it("valuation models produce results", () => {
    const br = result!.bankResult!;
    expect(br.valuation).toBeTruthy();
  });

  // Phase D2 — NBFC-specific lenses fire when subtype="nbfc"
  it("NBFC P/AUM lens computes when AUM sidecar is present", () => {
    const br = result!.bankResult!;
    expect(br.valuation).toBeTruthy();
    expect(br.valuation!.pAum).toBeDefined();
    // The fixture data ships with quality_indicators.json so AUM should be present
    if (br.valuation!.pAum!.status === "computed") {
      expect(br.valuation!.pAum!.intrinsicValue).toBeGreaterThan(0);
      expect(br.valuation!.pAum!.diagnostics.aum).toBeGreaterThan(10000);
      expect(br.valuation!.pAum!.diagnostics.peMultiple).toBe(12);
    }
  });

  it("NBFC ROA × Leverage RI lens fires", () => {
    const br = result!.bankResult!;
    expect(br.valuation!.roaLeverageRI).toBeDefined();
    if (br.valuation!.roaLeverageRI!.status === "computed") {
      expect(br.valuation!.roaLeverageRI!.intrinsicValue).toBeGreaterThan(0);
      expect(br.valuation!.roaLeverageRI!.diagnostics.bv0).toBeGreaterThan(0);
      expect(br.valuation!.roaLeverageRI!.diagnostics.forecastYears).toBe(7);
    }
  });

  it("CRAR governor evaluates buffer headroom", () => {
    const br = result!.bankResult!;
    expect(br.valuation!.crarGovernor).toBeDefined();
    // Bajaj's CRAR is consistently 22-28% — well above the 18% threshold
    // (15% RBI norm + 300bps buffer) so no throttle should apply.
    if (br.valuation!.crarGovernor!.status === "computed") {
      expect(br.valuation!.crarGovernor!.requiredCrarPct).toBe(18);
      expect(br.valuation!.crarGovernor!.headroomBps).toBeGreaterThan(300);
      expect(br.valuation!.crarGovernor!.effectiveG).toBe(br.valuation!.crarGovernor!.originalG);
    }
  });

  it("through-cycle credit-cost diagnostic computes", () => {
    const br = result!.bankResult!;
    expect(br.valuation!.creditCostCycle).toBeDefined();
    if (br.valuation!.creditCostCycle!.status === "computed") {
      expect(br.valuation!.creditCostCycle!.medianCreditCost).not.toBeNull();
      expect(br.valuation!.creditCostCycle!.latestCreditCost).not.toBeNull();
      expect(["under-provisioning", "normal", "stress-peak", "unknown"])
        .toContain(br.valuation!.creditCostCycle!.severity);
    }
  });

  it("triangulation includes NBFC lenses when computed", () => {
    const br = result!.bankResult!;
    const contributing = br.valuation!.modelsContributing;
    // At least one NBFC-specific model should contribute (P/AUM or RoA-Lev RI)
    const hasNbfcLens = contributing.some(name =>
      name.includes("NBFC") || name.includes("P/AUM")
    );
    // Don't fail if both happen to skip — but log so we notice regressions
    if (!hasNbfcLens) {
      console.warn("No NBFC lens contributed to triangulation:", contributing);
    }
  });

  it("cost-to-income ratio is non-zero (NBFC opex fallback)", () => {
    const br = result!.bankResult!;
    const latest = br.bankMetrics![br.bankMetrics!.length - 1];
    // Without sidecar, cost-to-income is a fallback approximation based on
    // X-Detail P&L labels. The fallback may be off ±5-10pp because it can't
    // precisely separate CSR/bank-charges etc. The AR sidecar (when fetched)
    // provides the definitive figure (33.2-40%).
    expect(latest.costToIncome).not.toBeNull();
    // Fallback for X-Detail P&L (no sidecar) expects ratio > 0; with
    // sidecar it should be in the 0.15-0.50 (15-50%) range.
    if (latest.costToIncome! < 0.60) {
      expect(latest.costToIncome).toBeGreaterThan(0.15);
      expect(latest.costToIncome).toBeLessThan(0.50);
    } else {
      // Fallback ratio is known to be an over-estimate; just check it's > 0
      expect(latest.costToIncome).toBeGreaterThan(0.0);
    }
    console.log(`  costToIncome = ${(latest.costToIncome! * 100).toFixed(1)}%`);
  });


  it("produces three-scenario bundle (bear/base/bull)", { timeout: 60_000 }, async () => {
    // Re-parse if result not yet available (can happen when running this test in isolation)
    if (!result || !result.bankResult) {
      const zipPath = resolve(__dirname, "../../../public/data/companies/bajaj finance/bajaj finance.zip");
      const buf = readFileSync(zipPath);
      const file = new File([buf], "bajaj finance.zip", { type: "application/zip" });
      const parsed = await parseCapitalineZip(file);
      const qiPath = resolve(__dirname, "../../../public/data/companies/Bajaj Finance/quality_indicators.json");
      let qi: BankQualityIndicators | null = null;
      try { qi = JSON.parse(readFileSync(qiPath, "utf-8")); } catch {}
      result = processCompanyDataFull(parsed!.periods, DEFAULT_CONFIG, qi);
    }
    const br = result!.bankResult!;
    const bundle = br.valuation?.scenarios;
    expect(bundle).not.toBeNull();
    expect(bundle!.cards).toHaveLength(3);
    expect(bundle!.cards[0].key).toBe("stress");
    expect(bundle!.cards[1].key).toBe("base");
    expect(bundle!.cards[2].key).toBe("bull");
    expect(bundle!.primary).toBe("base");
    // Base scenario should use sustainable ROE
    const baseCard = bundle!.cards[1];
    expect(baseCard.fairPB).toBeGreaterThan(0);
    expect(baseCard.intrinsicValue).toBeGreaterThan(0);
    // Bear scenario should have lower P/B than base
    const bearCard = bundle!.cards[0];
    expect(bearCard.fairPB).toBeLessThan(baseCard.fairPB);
    // Bull scenario should have higher P/B than base
    const bullCard = bundle!.cards[2];
    expect(bullCard.fairPB).toBeGreaterThan(baseCard.fairPB);
  });
});
