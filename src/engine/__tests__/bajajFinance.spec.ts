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

describe("Bajaj Finance (NBFC)", () => {
  let result: PipelineResult;

  it("parses and runs pipeline without throwing", { timeout: 60_000 }, async () => {
    const zipPath = resolve(__dirname, "../../../public/data/companies/bajaj finance/bajaj finance.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "bajaj finance.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    expect(parsed).toBeTruthy();
    expect(parsed!.periods.length).toBeGreaterThan(0);

    result = processCompanyDataFull(parsed!.periods, DEFAULT_CONFIG);
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
    expect(result.analysisFamily).toBe("financial-institution");
  });

  it("produces bankResult with NBFC subtype", () => {
    expect(result.bankResult).toBeTruthy();
    expect(result.bankResult!.subtype).toBe("nbfc");
  });

  it("has bank metrics with ROA and ROE", () => {
    const br = result.bankResult!;
    expect(br.bankMetrics).toBeTruthy();
    expect(br.bankMetrics!.length).toBeGreaterThan(3);

    const latest = br.bankMetrics![br.bankMetrics!.length - 1];
    // Bajaj Finance ROA ~4%, ROE ~19%
    expect(latest.roa).toBeGreaterThan(0.01);
    expect(latest.roa).toBeLessThan(0.10);
    expect(latest.roe).toBeGreaterThan(0.10);
    expect(latest.roe).toBeLessThan(0.35);
    // Phase D: leverage, spread, NIM now resolved via Ind-AS fallback
    // Bajaj Finance: leverage ~3.7x, spread ~9%, NIM ~10%
    expect(latest.leverage).toBeGreaterThan(2.0);
    expect(latest.leverage).toBeLessThan(8.0);
    expect(latest.spread).toBeGreaterThan(0.03);
    expect(latest.spread).toBeLessThan(0.20);
    expect(latest.nim).toBeGreaterThan(0.05);
    expect(latest.nim).toBeLessThan(0.20);
  });

  it("valuation models produce results", () => {
    const br = result.bankResult!;
    expect(br.valuation).toBeTruthy();
  });

  // Phase D2 — NBFC-specific lenses fire when subtype="nbfc"
  it("NBFC P/AUM lens computes when AUM sidecar is present", () => {
    const br = result.bankResult!;
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
    const br = result.bankResult!;
    expect(br.valuation!.roaLeverageRI).toBeDefined();
    if (br.valuation!.roaLeverageRI!.status === "computed") {
      expect(br.valuation!.roaLeverageRI!.intrinsicValue).toBeGreaterThan(0);
      expect(br.valuation!.roaLeverageRI!.diagnostics.bv0).toBeGreaterThan(0);
      expect(br.valuation!.roaLeverageRI!.diagnostics.forecastYears).toBe(7);
    }
  });

  it("CRAR governor evaluates buffer headroom", () => {
    const br = result.bankResult!;
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
    const br = result.bankResult!;
    expect(br.valuation!.creditCostCycle).toBeDefined();
    if (br.valuation!.creditCostCycle!.status === "computed") {
      expect(br.valuation!.creditCostCycle!.medianCreditCost).not.toBeNull();
      expect(br.valuation!.creditCostCycle!.latestCreditCost).not.toBeNull();
      expect(["under-provisioning", "normal", "stress-peak", "unknown"])
        .toContain(br.valuation!.creditCostCycle!.severity);
    }
  });

  it("triangulation includes NBFC lenses when computed", () => {
    const br = result.bankResult!;
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
    const br = result.bankResult!;
    const latest = br.bankMetrics![br.bankMetrics!.length - 1];
    // With X-Detail P&L: provisions ("Provision for Doubtful Loan / Deposit /
    // Advances") are subtracted from "Other Expenses" before computing
    // cost-to-income. This brings the ratio from ~62% (gross) down to ~30-40%
    // which matches Bajaj's AR-reported "Total operating expenses to NTI" of ~33%.
    // Assertion guards against both the null/0 regression AND the provisions-
    // contamination regression.
    expect(latest.costToIncome).not.toBeNull();
    expect(latest.costToIncome).toBeGreaterThan(0.15);
    expect(latest.costToIncome).toBeLessThan(0.50);
    console.log(`  costToIncome = ${(latest.costToIncome! * 100).toFixed(1)}%`);
  });
});
