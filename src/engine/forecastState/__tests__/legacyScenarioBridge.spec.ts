import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ForecastScenario, type RecastPeriod } from "../../types";
import { CroreShares } from "../../types/units";
import { buildIndustrialForecastFromLegacyScenario } from "..";

const LATEST = {
  period_end: "2026-03-31",
  bs: {
    TA: 1_500, CSE: 750, MI: 50, FA: 150, FO: 450, OA: 1_350, OL: 250,
    NOA: 1_100, NFO: 300, Inventory: 150, TradeReceivables: 150,
    OA_Inventory: 150, OA_TradeReceivables: 150, OA_PPE: 700, PPE: 700,
    OA_ROU: 100, OA_OtherIntangibles: 100, OA_Goodwill: 50, Goodwill: 50,
    OA_Other: 100, FO_LeaseLiabilities: 100, FO_FinancialDebtExLease: 350,
    separationScore: 100,
  },
  is: {
    Sales: 2_200, taxRate: 0.25, FinanceCost: 32, FinanceIncome: 4,
    CNI: 180, operatingCostBridge: { depreciation: 70 },
  },
  cf: { DividendPaid: 50 },
} as unknown as RecastPeriod;

const SCENARIO: ForecastScenario = {
  name: "base",
  probability: 0.5,
  horizonT: 3,
  drivers: {
    sales_growth: [0.08, 0.07, 0.06],
    core_sales_pm: [0.15, 0.15, 0.15],
    ato: [2, 2, 2],
    flev: [0.2, 0.2, 0.2],
    nbc: [0.06, 0.06, 0.06],
    g_terminal: 0.03,
    ke: 0.12,
    kw: 0.10,
  },
};

describe("legacy scenario to ForecastState bridge", () => {
  it("publishes a balanced explicit case when the recast anchor reconciles", () => {
    const result = buildIndustrialForecastFromLegacyScenario({
      caseId: "base",
      label: "Base",
      scenario: SCENARIO,
      latest: LATEST,
      config: { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) },
      analysisWindowId: "window-1",
      assumptionIds: ["growth", "margin"],
      evidenceRefs: ["fact-set-1"],
      probabilityStatus: "heuristic",
      probabilityRationale: "Legacy weighting is explicitly heuristic.",
    });
    expect(result.status, result.status === "blocked" ? result.reasonCodes.join("\n") : undefined).toBe("computed");
    if (result.status !== "computed") return;
    expect(result.forecastCase.projected).toHaveLength(3);
    expect(result.forecastCase.probabilityStatus).toBe("heuristic");
    for (const state of result.forecastCase.projected) {
      expect(state.balanceSheet.totalAssets).toBeCloseTo(state.balanceSheet.totalLiabilitiesAndEquity, 8);
      expect(state.cashFlow).not.toBe(LATEST.cf);
    }
  });

  it("blocks an unreconciled historical anchor instead of repairing it silently", () => {
    const result = buildIndustrialForecastFromLegacyScenario({
      caseId: "base",
      label: "Base",
      scenario: SCENARIO,
      latest: { ...LATEST, bs: { ...LATEST.bs, CSE: 700 } },
      config: { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) },
      analysisWindowId: "window-1",
      assumptionIds: [],
      evidenceRefs: [],
      probabilityStatus: "not-assigned",
      probabilityRationale: null,
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reasonCodes).toContain("anchor.balance-sheet");
    }
  });
});
