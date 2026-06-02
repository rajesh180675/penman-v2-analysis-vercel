import { describe, expect, it } from "vitest";
import { buildAssumptionEvidenceLedger } from "../assumptionLedger";
import type { ValuationScenarioCard, ReverseDcfDiagnostics } from "../../valuationCommandCenter";

function scenario(key: ValuationScenarioCard["key"], overrides: Partial<ValuationScenarioCard["assumptions"]> = {}): ValuationScenarioCard {
  return {
    key,
    label: `${key} case`,
    intrinsicPerShare: key === "base" ? 100 : 80,
    upsidePct: null,
    marginOfSafetyPct: null,
    expectedCagr: null,
    scenario: { drivers: {}, forecastPolicy: { terminalAnchorSource: "company-evidence" } } as unknown as ValuationScenarioCard["scenario"],
    valuation: { perShare: { intrinsic_re_per_share: 100, intrinsic_reoi_per_share: 104 } } as unknown as ValuationScenarioCard["valuation"],
    forecastPolicy: { terminalAnchorSource: "company-evidence" } as ValuationScenarioCard["forecastPolicy"],
    assumptions: {
      ke: 0.11,
      kw: 0.09,
      g: 0.04,
      salesGrowthYear1: 0.12,
      corePmYear1: 0.08,
      reinvestmentRateYear1: 0.42,
      incrementalRoicYear1: 0.18,
      ...overrides,
    },
  };
}

const reverseDcf: ReverseDcfDiagnostics = {
  impliedOwnerEarningsGrowth: 0.40,
  impliedTerminalROIC: 0.72,
  impliedKE: 0.065,
  normalizedGrowthAnchor: 0.08,
  expectationLabel: "Market is pricing perfection",
  narrativeSpace: [],
  spreadVsNormalizedGrowth: 0.32,
  marketExpectationLabel: "Extreme",
};

describe("buildAssumptionEvidenceLedger", () => {
  it("records scenario assumptions with explicit source and confidence metadata", () => {
    const ledger = buildAssumptionEvidenceLedger({
      scenarios: [scenario("base")],
      reverseDcf: null,
      periodEnd: "2025-03-31",
      companyId: "DMART",
    });

    expect(ledger.schemaVersion).toBe("2026-06-valuation-evidence-v1");
    expect(ledger.companyId).toBe("DMART");
    expect(ledger.rows.some((row) => row.key === "revenue_growth" && row.scenarioKey === "base")).toBe(true);
    expect(ledger.rows.some((row) => row.key === "terminal_growth" && row.sourceType === "clean-window-history")).toBe(true);
    expect(ledger.rows.every((row) => Number.isFinite(row.value ?? 0))).toBe(true);
    expect(ledger.summary.total).toBe(ledger.rows.length);
    expect(ledger.summary.confidenceEligibleCount).toBeGreaterThan(0);
  });

  it("quarantines market-implied reverse-DCF assumptions from intrinsic confidence", () => {
    const ledger = buildAssumptionEvidenceLedger({
      scenarios: [scenario("base")],
      reverseDcf,
      periodEnd: "2025-03-31",
    });

    const priceRows = ledger.rows.filter((row) => row.sourceType === "price-derived");
    expect(priceRows.length).toBeGreaterThan(0);
    expect(priceRows.every((row) => row.priceDerived)).toBe(true);
    expect(priceRows.every((row) => row.eligibleForIntrinsicConfidence === false)).toBe(true);
    expect(ledger.summary.priceDerivedCount).toBe(priceRows.length);
    expect(ledger.summary.highConfidenceCount).toBe(
      ledger.rows.filter((row) => row.confidence === "high" && row.eligibleForIntrinsicConfidence).length,
    );
  });

  it("marks missing scenario assumptions as source-unavailable instead of fabricating evidence", () => {
    const ledger = buildAssumptionEvidenceLedger({
      scenarios: [scenario("base", { reinvestmentRateYear1: null, incrementalRoicYear1: null })],
      reverseDcf: null,
    });

    const unavailable = ledger.rows.filter((row) => row.sourceType === "source-unavailable");
    expect(unavailable.map((row) => row.key)).toEqual(expect.arrayContaining(["reinvestment_rate", "rnoa"]));
    expect(ledger.summary.sourceUnavailableCount).toBe(unavailable.length);
    expect(ledger.summary.unsupportedCount).toBeGreaterThanOrEqual(unavailable.length);
  });
});
