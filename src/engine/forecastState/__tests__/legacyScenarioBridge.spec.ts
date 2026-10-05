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

  const bridge = (latest: RecastPeriod, scenario: ForecastScenario = SCENARIO) => buildIndustrialForecastFromLegacyScenario({
    caseId: "base",
    label: "Base",
    scenario,
    latest,
    config: { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) },
    analysisWindowId: "window-1",
    assumptionIds: [],
    evidenceRefs: [],
    probabilityStatus: "not-assigned",
    probabilityRationale: null,
  });
  const reasons = (result: ReturnType<typeof bridge>) => (result.status === "blocked" ? result.reasonCodes.join("\n") : undefined);

  it("scales every operating balance with NOA, so a rising turnover cannot push PPE below zero", () => {
    // Titan-shaped: inventory and receivables (1,300) are 59% of sales and
    // more than NOA (1,100); turnover rises from 2.0x to 2.6x. Held at their
    // share of revenue, they alone exceeded the forecast NOA and PPE went
    // negative in year 1.
    const latest = {
      ...LATEST,
      bs: { ...LATEST.bs, OA: 1_400, OL: 400, NOA: 1_000, OA_Inventory: 900, OA_TradeReceivables: 400, OA_PPE: 50, PPE: 50,
        OA_ROU: 20, OA_OtherIntangibles: 10, OA_Goodwill: 0, Goodwill: 0, OA_Other: 20, CSE: 650 },
    } as unknown as RecastPeriod;
    const result = bridge(latest, { ...SCENARIO, drivers: { ...SCENARIO.drivers, ato: [2.6, 2.6, 2.6] } });
    expect(result.status, reasons(result)).toBe("computed");
    if (result.status !== "computed") return;
    for (const state of result.forecastCase.projected) {
      expect(state.balanceSheet.operatingAssets.ppe).toBeGreaterThanOrEqual(0);
      expect(state.incomeStatement.revenue).toBeCloseTo(state.balanceSheet.noa * 2.6, 6);
    }
  });

  it("funds a cash shortfall with a revolving draw instead of publishing negative cash", () => {
    // NTPC-shaped: little cash, and investment ahead of cash from operations
    // (turnover falls, so NOA must grow faster than sales).
    const latest = { ...LATEST, bs: { ...LATEST.bs, FA: 5, FO: 305, FO_FinancialDebtExLease: 205, NFO: 300 } } as unknown as RecastPeriod;
    const result = bridge(latest, { ...SCENARIO, drivers: { ...SCENARIO.drivers, ato: [1.2, 1.2, 1.2] } });
    expect(result.status, reasons(result)).toBe("computed");
    if (result.status !== "computed") return;
    const issued = result.forecastCase.projected.reduce((sum, s) => sum + s.assumptions.debtIssuance, 0);
    expect(issued).toBeGreaterThan(0);
    for (const state of result.forecastCase.projected) {
      expect(state.balanceSheet.financialAssets.cash).toBeGreaterThanOrEqual(0);
      // The draw is financing: it shows in the debt balance and its interest in NFE.
      expect(state.balanceSheet.totalAssets).toBeCloseTo(state.balanceSheet.totalLiabilitiesAndEquity, 6);
    }
    const lastDebt = result.forecastCase.projected.at(-1)!.balanceSheet.financialObligations.debt;
    expect(lastDebt).toBeCloseTo(205 + issued, 6);
  });

  it("funds every short year of a long forecast, each draw covering its own interest", () => {
    // Grasim-shaped: investment outruns cash from operations year after year.
    // A draw grossed up by only 1% left each year short by its own interest at
    // a ~10% cost of debt; each pass shrank the gap until it fell under
    // floating-point resolution and stuck, the 40 passes ran out, and later
    // years published negative cash.
    const latest = { ...LATEST, bs: { ...LATEST.bs, FA: 5, FO: 305, FO_FinancialDebtExLease: 205, NFO: 300 } } as unknown as RecastPeriod;
    const years = 12;
    const result = bridge(latest, {
      ...SCENARIO,
      horizonT: years,
      drivers: { ...SCENARIO.drivers, sales_growth: Array(years).fill(0.12), ato: Array.from({ length: years }, (_, i) => 1.4 - i * 0.03) },
    });
    expect(result.status, reasons(result)).toBe("computed");
    if (result.status !== "computed") return;
    // Half the years run short: far more passes than 40 at the old sizing.
    expect(result.forecastCase.projected.filter((s) => s.assumptions.debtIssuance > 0).length).toBeGreaterThanOrEqual(6);
    for (const state of result.forecastCase.projected) expect(state.balanceSheet.financialAssets.cash).toBeGreaterThanOrEqual(0);
  });

  it("draws nothing when the forecast funds itself", () => {
    const result = bridge(LATEST);
    expect(result.status, reasons(result)).toBe("computed");
    if (result.status !== "computed") return;
    expect(result.forecastCase.projected.every((s) => s.assumptions.debtIssuance === 0)).toBe(true);
  });

  it("accepts operating balances above one year's revenue, as an asset-heavy company has", () => {
    // Power Grid-shaped: NOA about 4.4x sales. A balance-to-revenue ratio is a
    // stock over a flow and has no ceiling of one.
    const latest = {
      ...LATEST,
      is: { ...LATEST.is, Sales: 250 },
      bs: { ...LATEST.bs, OA_Other: 100 },
    } as unknown as RecastPeriod;
    const result = bridge(latest, { ...SCENARIO, drivers: { ...SCENARIO.drivers, ato: [0.23, 0.23, 0.23] } });
    expect(reasons(result) ?? "").not.toMatch(/ratio-bound/);
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
