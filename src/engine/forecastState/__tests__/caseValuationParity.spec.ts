import { describe, expect, it } from "vitest";
import { buildScenario, buildValuationPeriodsFromForecast } from "../../forecastingEngine/scenarios";
import { computeValuation } from "../../PenmanNissimEngine";
import { DEFAULT_CONFIG, type ForecastScenario, type RecastPeriod } from "../../types";
import { CroreShares } from "../../types/units";
import { buildIndustrialForecastFromLegacyScenario, compareCaseValuations } from "..";

const LATEST = {
  period_end: "2026-03-31",
  bs: {
    TA: 1_500, CSE: 750, MI: 50, FA: 150, FO: 450, OA: 1_350, OL: 250,
    NOA: 1_100, NFO: 300, Inventory: 150, TradeReceivables: 150,
    OA_Inventory: 150, OA_TradeReceivables: 150, OA_PPE: 700, PPE: 700,
    OA_ROU: 100, OA_OtherIntangibles: 100, OA_Goodwill: 50, Goodwill: 50,
    OA_Other: 100, FO_LeaseLiabilities: 100, FO_FinancialDebtExLease: 350,
    separationScore: 100,
    // A carved-out lending arm's stake, which every equity value adds.
    CarvedArmStakeValue: 40,
  },
  is: {
    Sales: 2_200, OI: 330, taxRate: 0.25, FinanceCost: 32, FinanceIncome: 4,
    CNI: 180, operatingCostBridge: { depreciation: 70 },
  },
  cf: { DividendPaid: 50, d_t: 50 },
  ratios: { RNOA: 0.3 },
} as unknown as RecastPeriod;

// A minority with a share of income, and owners paid beyond earnings, so the
// minority's income, the buybacks and the anchor's stake all reach the values.
const SCENARIO: ForecastScenario = {
  name: "base",
  probability: 0.5,
  horizonT: 4,
  drivers: {
    sales_growth: [0.08, 0.07, 0.06, 0.05],
    core_sales_pm: [0.15, 0.15, 0.15, 0.15],
    ato: [2, 2, 2, 2],
    flev: [0.2, 0.2, 0.2, 0.2],
    nbc: [0.06, 0.06, 0.06, 0.06],
    mi_ratio: [0.06, 0.06, 0.06, 0.06],
    mii_share: [0.05, 0.05, 0.05, 0.05],
    owner_payout: [400, 420, 440, 460],
    g_terminal: 0.03,
    ke: 0.12,
    kw: 0.10,
  },
};
const CONFIG = { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) };

function recordedCase(scenario: ForecastScenario) {
  return buildIndustrialForecastFromLegacyScenario({
    caseId: "base",
    label: "Base",
    scenario,
    latest: LATEST,
    config: CONFIG,
    analysisWindowId: "window-1",
    assumptionIds: [],
    evidenceRefs: [],
    probabilityStatus: "not-assigned",
    probabilityRationale: null,
  });
}

/** The command center's valuation of a scenario (valuationCommandCenter/builders.ts). */
function commandCenterValuation(scenario: ForecastScenario) {
  return computeValuation(
    buildValuationPeriodsFromForecast(LATEST, buildScenario(scenario, LATEST)),
    scenario.drivers.ke,
    scenario.drivers.kw,
    scenario.drivers.g_terminal,
    CONFIG,
  );
}

describe("forecast case valuation parity", () => {
  it("values a recorded forecast case as the command center valued its scenario, model by model", () => {
    const valuation = commandCenterValuation(SCENARIO);
    // The values compared are real: every model valued, owners paid beyond earnings.
    expect(valuation.V_RE_CV3).toBeGreaterThan(0);
    expect(valuation.perShare?.intrinsic_ddm_per_share).toBeGreaterThan(0);
    expect(valuation.minorityClaimBasis).toBe("residual-income");
    const recorded = recordedCase(SCENARIO);
    expect(recorded.status).toBe("computed");
    if (recorded.status !== "computed") return;
    expect(recorded.forecastCase.projected.some((state) => state.cashFlow.buybacks > 0)).toBe(true);

    expect(compareCaseValuations({
      scenarios: [{ key: "base", valuation }],
      forecastResults: [recorded],
      anchor: LATEST,
      valuationConfig: CONFIG,
    })).toEqual([]);
  });

  it("reports every value on which a case recorded from another forecast disagrees", () => {
    const valuation = commandCenterValuation(SCENARIO);
    const faster = recordedCase({ ...SCENARIO, drivers: { ...SCENARIO.drivers, sales_growth: [0.12, 0.11, 0.10, 0.09] } });
    const divergences = compareCaseValuations({
      scenarios: [{ key: "base", valuation }],
      forecastResults: [faster],
      anchor: LATEST,
      valuationConfig: CONFIG,
    });
    // The payout is a fixed amount, so faster growth moves every value but the
    // distributions owners receive (the dividend and FCFE models).
    expect(divergences.map((divergence) => divergence.field)).toEqual([
      "V_RE_CV1", "V_RE_CV2", "V_RE_CV3", "V_ReOI_CV01", "V_ReOI_CV02", "V_ReOI_CV03", "V_no_growth",
      "intrinsic_re_per_share", "intrinsic_reoi_per_share", "intrinsic_fcff_per_share", "intrinsic_aeg_per_share",
    ]);
    for (const divergence of divergences) expect(divergence.caseId).toBe("base");
  });

  it("checks only the cases that computed", () => {
    expect(compareCaseValuations({
      scenarios: [{ key: "base", valuation: commandCenterValuation(SCENARIO) }],
      forecastResults: [],
      anchor: LATEST,
      valuationConfig: CONFIG,
    })).toEqual([]);
  });
});
