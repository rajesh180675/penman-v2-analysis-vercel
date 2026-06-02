import { describe, expect, it } from "vitest";
import { runAllDetectors, type NormalizedPeriod } from "../greenfieldPipeline";

type PeriodOverrides = Partial<Omit<NormalizedPeriod, "values" | "derived">> & {
  values?: Partial<NormalizedPeriod["values"]>;
  derived?: Partial<NormalizedPeriod["derived"]>;
};

function period(periodEnd: string, overrides: PeriodOverrides = {}): NormalizedPeriod {
  const base: NormalizedPeriod = {
    companyId: "DMART",
    periodEnd,
    periodStart: null,
    isPartialPeriod: false,
    periodLengthDays: 365,
    accountingStandard: "ind-as",
    standardAdoptions: { indAS109: true, indAS115: true, indAS116: periodEnd >= "2020-03-31", adoptionDateEvidence: { indAS109: "2016-04-01", indAS115: "2018-04-01", indAS116: "2019-04-01" } },
    industry: { companyType: "consumer", inferredIndustry: "consumer", confidence: "explicit" },
    values: {
      revenue: 100_000_000_000,
      cse: 20_000_000_000,
      totalAssets: 60_000_000_000,
      totalLiabilities: 40_000_000_000,
      cfo: 3_000_000_000,
      capex: 1_000_000_000,
      fcfCash: 2_000_000_000,
      leaseLiabilities: null,
      rightOfUseAssets: null,
      financialDebtExLease: 0,
      nfo: -1_000_000_000,
      nfoExLease: -1_000_000_000,
      leaseNeutralEquity: null,
      dividendsPaid: 0,
      equityIssued: 0,
      buybacks: 0,
      netIncome: 2_000_000_000,
      oci: 0,
    },
    derived: { rnoa: 0.14, flev: -0.05, pm: 0.05, ato: 2.8, dirtySurplusSeed: 0 },
    lineage: [],
  };
  return { ...base, ...overrides, values: { ...base.values, ...(overrides.values ?? {}) }, derived: { ...base.derived, ...(overrides.derived ?? {}) } };
}

describe("greenfield L2 detectors", () => {
  it("lets D4 propose same-period suppression for D2 dirty surplus", () => {
    const signals = runAllDetectors([
      period("2024-03-31", { values: { cse: 20_000_000_000, oci: 900_000_000 }, derived: { dirtySurplusSeed: 1_000_000_000 } }),
    ], { asOf: "2026-06-02" });

    expect(signals.some((signal) => signal.detectorId === "D2_DIRTY_SURPLUS")).toBe(true);
    const d4 = signals.find((signal) => signal.detectorId === "D4_FX_OCI_TRANSLATION");
    expect(d4).toBeDefined();
    expect(d4!.suppresses).toContainEqual({ detectorId: "D2_DIRTY_SURPLUS", period: "2024-03-31", reason: "OCI/FX translation explains same-period dirty-surplus residual." });
  });

  it("classifies DMART-shaped recovered negative equity as artifact warning, not valuation block", () => {
    const signals = runAllDetectors([
      period("2020-03-31", { values: { cse: -1_000_000_000, leaseLiabilities: 8_000_000_000, rightOfUseAssets: 7_000_000_000 } }),
      period("2021-03-31", { values: { cse: -500_000_000, leaseLiabilities: 9_000_000_000, rightOfUseAssets: 8_000_000_000 } }),
      period("2025-03-31", { values: { cse: 214_267_000_000, cfo: 24_629_700_000, nfoExLease: -530_200_000 } }),
    ], { asOf: "2026-06-02" });

    const d5 = signals.find((signal) => signal.detectorId === "D5_NEGATIVE_EQUITY_SOLVENCY");
    expect(d5).toBeDefined();
    expect(d5!.severity).toBe("WARNING");
    expect(d5!.blocksValuation).toBe(false);
    expect(d5!.p_artifact).toBeGreaterThan(0.8);
  });

  it("keeps expansion FCF and market saturation as real non-adjusted signals", () => {
    const signals = runAllDetectors([
      period("2025-03-31", { values: { cfo: 24_629_700_000, capex: 34_230_400_000, fcfCash: -9_600_700_000 } }),
    ], { asOf: "2026-06-02", marketExpectation: { marginOfSafetyPct: -0.95, reverseDcfSaturated: true, price: 4071.8, intrinsicValue: 200 } });

    const fcf = signals.find((signal) => signal.detectorId === "D10_EXPANSION_CAPEX_FCF");
    const overvaluation = signals.find((signal) => signal.label === "OVERVALUATION_SIGNAL");
    const saturation = signals.find((signal) => signal.label === "REVERSE_DCF_SATURATION");
    expect(fcf).toBeDefined();
    expect(fcf!.suggestedAdjusters).toHaveLength(0);
    expect(overvaluation!.p_artifact).toBeLessThan(0.1);
    expect(saturation!.suggestedAdjusters).toHaveLength(0);
  });

  it("blocks real current negative equity with cash burn", () => {
    const signals = runAllDetectors([
      period("2023-03-31", { values: { cse: -5_000_000_000, cfo: 1_000_000_000, nfoExLease: 20_000_000_000 } }),
      period("2024-03-31", { values: { cse: -8_000_000_000, cfo: 500_000_000, nfoExLease: 25_000_000_000 } }),
      period("2025-03-31", { values: { cse: -12_000_000_000, cfo: -100_000_000, nfoExLease: 30_000_000_000 } }),
    ], { asOf: "2026-06-02" });

    const d5 = signals.find((signal) => signal.detectorId === "D5_NEGATIVE_EQUITY_SOLVENCY");
    expect(d5).toBeDefined();
    expect(d5!.severity).toBe("CRITICAL");
    expect(d5!.blocksValuation).toBe(true);
    expect(d5!.p_artifact).toBeLessThan(0.5);
  });
});
