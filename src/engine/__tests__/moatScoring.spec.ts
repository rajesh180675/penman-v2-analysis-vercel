/**
 * Tests for Economic Moat Scoring module
 */
import { describe, it, expect } from "vitest";
import { computeMoatScore, computeBankMoatScore } from "../moatScoring";
import { DEFAULT_CONFIG } from "../types";
import { PercentFraction } from "../types/units";
import type { RecastPeriod } from "../types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePeriod(overrides: {
  period_end: string;
  RNOA: number;
  SPREAD: number;
  CoreSalesPM: number;
  ATO: number;
  CoreOI: number;
  NOA: number;
  CSE: number;
}): RecastPeriod {
  return {
    period_end: overrides.period_end,
    bs: {
      TA: overrides.NOA + 200, CSE: overrides.CSE, MI: 0,
      FA: 100, FO: 50, OA: overrides.NOA + 100, OL: 400,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 100,
      OL_ProvisionsCurrent: 50, OL_ProvisionsLongTerm: 50,
      OL_CurrentTaxLiabilities: 50, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 50, OL_OtherNonCurrentLiabilities: 0,
      NOA: overrides.NOA, NFO: 100,
      DTL: 50, PensionObl: 0, OL_ex_DTL: 350,
      Goodwill: 0, CurrentAssets: 500, CurrentLiabilities: 300,
      BridgeDebtTotal: 100,
      Inventory: 100, TradeReceivables: 150, TradePayables: 100,
      PPE: 300, LIFO_reserve: 0, separationScore: 0.8,
      OA_PPE: 300, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 150, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: overrides.NOA - 700,
    } as RecastPeriod["bs"],
    is: {
      Sales: overrides.CoreOI / overrides.CoreSalesPM,
      TaxExpense: overrides.CoreOI * 0.25,
      taxRate: 0.25,
      PAT: overrides.CoreOI * 0.75,
      OCI: 0, TCI: overrides.CoreOI * 0.75, TCI_NCI: 0,
      CNI: overrides.CoreOI * 0.75,
      FinanceCost: 10, FinanceIncome: 2, FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: -8, OI: overrides.CoreOI, OtherItems: 0, OI_from_sales: 0, MII: 0,
      COGS: (overrides.CoreOI / overrides.CoreSalesPM) * 0.5,
    } as RecastPeriod["is"],
    cu: {
      UOI: 0, CoreOI: overrides.CoreOI,
      UFE: 0, CoreNFE: -8,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as RecastPeriod["cu"],
    cf: {
      CFO: overrides.CoreOI * 0.9,
      Capex: 50,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 2,
      DividendReceived: 0,
    } as RecastPeriod["cf"],
    ratios: {
      RNOA: overrides.RNOA,
      SPREAD: overrides.SPREAD,
      CoreSalesPM: overrides.CoreSalesPM,
      ATO: overrides.ATO,
      ROCE: overrides.RNOA + 0.02,
      NBC: 0.06, FLEV: 0.2,
      PM: overrides.CoreSalesPM,
      SalesPM: overrides.CoreSalesPM,
      ATO_star: overrides.ATO,
      OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.06, ROOA: overrides.RNOA, OLLEV: 0.1, OLSPREAD: 0.02, RNOA_check: overrides.RNOA,
      ROTCE: overrides.RNOA, MSR: 0,
      CoreOtherItems_OA: 0, UOI_OA: 0, CoreNBC: 0.06, UFE_NFO: 0,
      CoreSPREAD: overrides.SPREAD,
      ROCE_eq16_reconstructed: overrides.RNOA, ROCE_eq16_error: 0,
      eq16_step1_residual: 0, eq16_step2_residual: 0, eq16_step3_residual: 0,
      eq16_flag: "OK",
      eq16_diagnosis: null,
      ROOA_spec: overrides.RNOA, imputed_io_spec: 0.06,
      required_return_per_sales: null, value_creating_margin: null,
      CSE_eq8_check: null, CSE_eq8_error_pct: null,
      current_ratio: 1.5, quick_ratio: 1.0,
      days_receivable: 45, days_payable: 30, days_inventory: 60,
      cash_conversion_cycle: 75,
      accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.01,
      cash_conversion_ratio: 0.9,
      interest_coverage: 10,
      NOA_growth: 0.08, CNI_growth: 0.10, OI_growth: 0.10, Sales_growth: 0.10,
      noaSmall: false, separationScore: 0.8,
      accrual_regime: "NORMAL",
      dirty_surplus: 0, dirty_surplus_pct_cse: 0,
      freeOL: null, interestBearingOL: null, OLLEV_check: null, RNOA_vs_OLLEV_residual: null,
    employeeCostRatio: null,
    } as RecastPeriod["ratios"],
  };
}

const BASE_CONFIG = { ...DEFAULT_CONFIG, ke: PercentFraction(0.12) };

// ── Wide moat company: high RNOA, stable margins, strong SPREAD ───────────────
const WIDE_MOAT_PERIODS: RecastPeriod[] = [
  makePeriod({ period_end: "2019-03-31", RNOA: 0.28, SPREAD: 0.17, CoreSalesPM: 0.22, ATO: 1.3, CoreOI: 2200, NOA: 8000, CSE: 7000 }),
  makePeriod({ period_end: "2020-03-31", RNOA: 0.27, SPREAD: 0.16, CoreSalesPM: 0.21, ATO: 1.3, CoreOI: 2100, NOA: 8200, CSE: 7200 }),
  makePeriod({ period_end: "2021-03-31", RNOA: 0.29, SPREAD: 0.18, CoreSalesPM: 0.23, ATO: 1.3, CoreOI: 2400, NOA: 8500, CSE: 7500 }),
  makePeriod({ period_end: "2022-03-31", RNOA: 0.30, SPREAD: 0.19, CoreSalesPM: 0.24, ATO: 1.3, CoreOI: 2600, NOA: 8800, CSE: 7800 }),
  makePeriod({ period_end: "2023-03-31", RNOA: 0.31, SPREAD: 0.20, CoreSalesPM: 0.25, ATO: 1.3, CoreOI: 2800, NOA: 9000, CSE: 8000 }),
  makePeriod({ period_end: "2024-03-31", RNOA: 0.30, SPREAD: 0.19, CoreSalesPM: 0.24, ATO: 1.3, CoreOI: 3000, NOA: 9500, CSE: 8500 }),
  makePeriod({ period_end: "2025-03-31", RNOA: 0.32, SPREAD: 0.21, CoreSalesPM: 0.26, ATO: 1.3, CoreOI: 3200, NOA: 10000, CSE: 9000 }),
];

// ── No moat company: RNOA near kw, thin margins ───────────────────────────────
const NO_MOAT_PERIODS: RecastPeriod[] = [
  makePeriod({ period_end: "2019-03-31", RNOA: 0.11, SPREAD: -0.01, CoreSalesPM: 0.04, ATO: 2.5, CoreOI: 400, NOA: 4000, CSE: 3500 }),
  makePeriod({ period_end: "2020-03-31", RNOA: 0.10, SPREAD: -0.02, CoreSalesPM: 0.03, ATO: 2.5, CoreOI: 300, NOA: 4100, CSE: 3600 }),
  makePeriod({ period_end: "2021-03-31", RNOA: 0.12, SPREAD: 0.00, CoreSalesPM: 0.04, ATO: 2.5, CoreOI: 420, NOA: 4200, CSE: 3700 }),
  makePeriod({ period_end: "2022-03-31", RNOA: 0.09, SPREAD: -0.03, CoreSalesPM: 0.03, ATO: 2.5, CoreOI: 320, NOA: 4300, CSE: 3800 }),
  makePeriod({ period_end: "2023-03-31", RNOA: 0.11, SPREAD: -0.01, CoreSalesPM: 0.04, ATO: 2.5, CoreOI: 380, NOA: 4400, CSE: 3900 }),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeMoatScore — wide moat company", () => {
  it("returns a result", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG);
    expect(result).not.toBeNull();
  });

  it("classifies as wide moat", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.moatWidth).toBe("wide");
  });

  it("composite score is high (≥ 70)", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.compositeScore).toBeGreaterThanOrEqual(70);
  });

  it("all periods above cost of capital", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.periodsAboveCostOfCapital).toBe(WIDE_MOAT_PERIODS.length);
    // This fixture stamps a SPREAD on every period, so all three counts
    // coincide — which is why a case named for this behaviour could not catch
    // the surfaces dividing by `totalPeriods`. Real pipeline output never has
    // them coincide; see the `spreadMeasuredPeriods` block below.
    expect(result.spreadMeasuredPeriods).toBe(WIDE_MOAT_PERIODS.length);
    expect(result.totalPeriods).toBe(WIDE_MOAT_PERIODS.length);
  });

  it("median RNOA is ~0.30", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.medianRNOA).toBeCloseTo(0.30, 1);
  });

  it("median SPREAD is positive", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.medianSPREAD).toBeGreaterThan(0);
  });

  it("has 5 dimensions", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.dimensions).toHaveLength(5);
  });

  it("dimension weights sum to 1.0", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    const totalWeight = result.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 2);
  });

  it("each dimension has evidence", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    for (const d of result.dimensions) {
      expect(d.evidence.length).toBeGreaterThan(0);
    }
  });

  it("CAP estimate is positive for wide moat", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    if (result.cap.years != null) {
      expect(result.cap.years).toBeGreaterThan(0);
    }
  });

  it("moat trend is stable or strengthening", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(["stable", "strengthening"]).toContain(result.moatTrend);
  });
});

describe("computeMoatScore — no moat company", () => {
  it("classifies as none", () => {
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.moatWidth).toBe("none");
  });

  it("composite score is low (< 40)", () => {
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.compositeScore).toBeLessThan(40);
  });

  it("few or no periods with strong spread", () => {
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.periodsWithStrongSpread).toBe(0);
  });

  it("CAP is 0 when RNOA ≤ kw", () => {
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    if (result.cap.latestRNOA != null && result.cap.latestRNOA <= result.cap.kw) {
      expect(result.cap.years).toBe(0);
    }
  });
});

describe("computeMoatScore — SPREAD-bearing periods vs periods analysed", () => {
  // The counts the surfaces render as a ratio come from different populations:
  // `periodsAboveCostOfCapital` and `periodsWithStrongSpread` are counted over
  // periods with a finite SPREAD, while `totalPeriods` is every period passed
  // in. `spreadMeasuredPeriods` is the population the first two are drawn from,
  // so a surface can divide by it instead of overstating the shortfall.

  it("excludes a period the pipeline gave no ratios from the SPREAD population", () => {
    // `pipeline.ts:285` computes ratios only from i > 0, so the oldest period
    // of every real run arrives without any — the one-period gap the surfaces
    // used to report as a year below cost of capital.
    const withoutOldestRatios = WIDE_MOAT_PERIODS.map((p, i) =>
      i === 0 ? { ...p, ratios: undefined } as unknown as RecastPeriod : p,
    );
    const result = computeMoatScore(withoutOldestRatios, BASE_CONFIG)!;
    expect(result.totalPeriods).toBe(7);
    expect(result.spreadMeasuredPeriods).toBe(6);
    expect(result.periodsAboveCostOfCapital).toBe(6);
  });

  it("reports zero measured periods for a company whose SPREAD is never computable", () => {
    // SPREAD is null whenever |avgNFO| <= 1 (ratiosResidual.ts:32-33) — an
    // effectively debt-free company. Every period is analysed and none is
    // measured, so the ratio has no denominator at all.
    const noSpread = WIDE_MOAT_PERIODS.map(p => ({
      ...p,
      ratios: { ...p.ratios, SPREAD: null } as unknown as RecastPeriod["ratios"],
    }));
    const result = computeMoatScore(noSpread, BASE_CONFIG)!;
    expect(result.totalPeriods).toBe(7);
    expect(result.spreadMeasuredPeriods).toBe(0);
    expect(result.periodsAboveCostOfCapital).toBe(0);
    expect(result.periodsWithStrongSpread).toBe(0);
    expect(result.medianSPREAD).toBeNull();
  });

  it("counts a measured period that failed to clear kw in the denominator only", () => {
    // The denominator has to be the measurable population, not the qualifying
    // one. Every period here carries a SPREAD and none of them is positive, so
    // this is the one shape that tells `spreadValues.length` apart from
    // `periodsAboveCostOfCapital` — the weak inequalities below hold either way.
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.spreadMeasuredPeriods).toBe(NO_MOAT_PERIODS.length);
    expect(result.periodsAboveCostOfCapital).toBe(0);
  });

  it("never reports more measured periods than periods analysed", () => {
    const result = computeMoatScore(NO_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.spreadMeasuredPeriods).toBeLessThanOrEqual(result.totalPeriods);
    expect(result.periodsAboveCostOfCapital).toBeLessThanOrEqual(result.spreadMeasuredPeriods);
    expect(result.periodsWithStrongSpread).toBeLessThanOrEqual(result.spreadMeasuredPeriods);
  });
});

describe("computeMoatScore — edge cases", () => {
  it("returns null for fewer than 3 periods", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS.slice(0, 2), BASE_CONFIG);
    expect(result).toBeNull();
  });

  // Phase I robustness — moat skip-with-reason for loss-makers
  it("flags dataSufficient=false when no periods have positive RNOA", () => {
    const lossPeriods = Array.from({ length: 5 }, (_, i) =>
      makePeriod({
        period_end: `${2020 + i}-03-31`,
        RNOA: -0.05,
        SPREAD: -0.13,
        CoreSalesPM: -0.05,
        ATO: 1.0,
        CoreOI: -50,
        NOA: 1000,
        CSE: 800,
      }),
    );
    const result = computeMoatScore(lossPeriods, BASE_CONFIG)!;
    expect(result.dataSufficient).toBe(false);
    expect(result.positiveRNOAPeriods).toBe(0);
    expect(result.skipReason).toMatch(/No periods with positive RNOA/);
    expect(result.notes[0]).toBe(result.skipReason);
  });

  it("flags dataSufficient=false when only 1-2 profitable periods", () => {
    // Turnaround: 3 loss years, 2 profit years
    const turnaround = [
      ...Array.from({ length: 3 }, (_, i) => makePeriod({
        period_end: `${2020 + i}-03-31`,
        RNOA: -0.05, SPREAD: -0.13, CoreSalesPM: -0.05, ATO: 1.0,
        CoreOI: -50, NOA: 1000, CSE: 800,
      })),
      ...Array.from({ length: 2 }, (_, i) => makePeriod({
        period_end: `${2023 + i}-03-31`,
        RNOA: 0.15, SPREAD: 0.07, CoreSalesPM: 0.15, ATO: 1.0,
        CoreOI: 150, NOA: 1000, CSE: 800,
      })),
    ];
    const result = computeMoatScore(turnaround, BASE_CONFIG)!;
    expect(result.dataSufficient).toBe(false);
    expect(result.positiveRNOAPeriods).toBe(2);
    expect(result.skipReason).toMatch(/Only 2 period/);
  });

  it("flags dataSufficient=true when ≥3 profitable periods", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.dataSufficient).toBe(true);
    expect(result.skipReason).toBeNull();
    expect(result.positiveRNOAPeriods).toBeGreaterThanOrEqual(3);
  });

  it("scores are all in [0, 100]", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    for (const d of result.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
    }
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it("totalPeriods matches input length", () => {
    const result = computeMoatScore(WIDE_MOAT_PERIODS, BASE_CONFIG)!;
    expect(result.totalPeriods).toBe(WIDE_MOAT_PERIODS.length);
  });
});

// ─── Bank Moat Tests ──────────────────────────────────────────────────────────

describe("computeBankMoatScore", () => {
  // Phase K — added new NBFC-specific fields (all null for banks).
  const NBFC_DEFAULTS = {
    nonConvertibleDebentures: null,
    termLoansFromBanks: null,
    termLoansFromInstitutions: null,
    termLoansFromOthers: null,
    leverage: null,
    costOfBorrowings: null,
    yieldOnAdvances: null,
    spread: null,
    debtMix: null,
    quality: null,
  } as const;

  const strongBankMetrics = [
    { period_end: "2019-03-31", totalAssets: 500000, totalEquity: 40000, advances: 300000, deposits: 380000, investments: 80000, borrowings: 20000, cashAndBalanceWithRBI: 20000, interestEarned: 30000, interestExpended: 15000, nii: 15000, otherIncome: 5000, operatingExpenses: 8000, provisions: 3000, pat: 6000, pbt: 8000, nim: 0.04, roa: 0.012, roe: 0.18, creditCost: 0.01, costToIncome: 0.40, casaRatio: null,
    dividendPaid: null, ...NBFC_DEFAULTS },
    { period_end: "2020-03-31", totalAssets: 550000, totalEquity: 44000, advances: 330000, deposits: 420000, investments: 88000, borrowings: 22000, cashAndBalanceWithRBI: 22000, interestEarned: 33000, interestExpended: 16500, nii: 16500, otherIncome: 5500, operatingExpenses: 8800, provisions: 3300, pat: 6600, pbt: 8800, nim: 0.041, roa: 0.012, roe: 0.17, creditCost: 0.01, costToIncome: 0.40, casaRatio: null,
    dividendPaid: null, ...NBFC_DEFAULTS },
    { period_end: "2021-03-31", totalAssets: 600000, totalEquity: 48000, advances: 360000, deposits: 460000, investments: 96000, borrowings: 24000, cashAndBalanceWithRBI: 24000, interestEarned: 36000, interestExpended: 18000, nii: 18000, otherIncome: 6000, operatingExpenses: 9600, provisions: 3600, pat: 7200, pbt: 9600, nim: 0.042, roa: 0.012, roe: 0.18, creditCost: 0.01, costToIncome: 0.40, casaRatio: null,
    dividendPaid: null, ...NBFC_DEFAULTS },
    { period_end: "2022-03-31", totalAssets: 650000, totalEquity: 52000, advances: 390000, deposits: 500000, investments: 104000, borrowings: 26000, cashAndBalanceWithRBI: 26000, interestEarned: 39000, interestExpended: 19500, nii: 19500, otherIncome: 6500, operatingExpenses: 10400, provisions: 3900, pat: 7800, pbt: 10400, nim: 0.043, roa: 0.012, roe: 0.17, creditCost: 0.01, costToIncome: 0.40, casaRatio: null,
    dividendPaid: null, ...NBFC_DEFAULTS },
    { period_end: "2023-03-31", totalAssets: 700000, totalEquity: 56000, advances: 420000, deposits: 540000, investments: 112000, borrowings: 28000, cashAndBalanceWithRBI: 28000, interestEarned: 42000, interestExpended: 21000, nii: 21000, otherIncome: 7000, operatingExpenses: 11200, provisions: 4200, pat: 8400, pbt: 11200, nim: 0.044, roa: 0.012, roe: 0.18, creditCost: 0.01, costToIncome: 0.40, casaRatio: null,
    dividendPaid: null, ...NBFC_DEFAULTS },
  ];

  it("returns a result for sufficient data", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG);
    expect(result).not.toBeNull();
  });

  it("classifies as narrow or wide moat for ROE > ke", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG)!;
    // ROE ~17-18% > ke 12% → should be narrow or wide
    expect(["narrow", "wide"]).toContain(result.moatWidth);
  });

  it("all periods above ke", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG)!;
    expect(result.periodsAboveKe).toBe(strongBankMetrics.length);
  });

  it("medianROESpread is positive", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG)!;
    expect(result.medianROESpread).toBeGreaterThan(0);
  });

  it("composite score is in [0, 100]", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG)!;
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it("returns null for fewer than 3 periods", () => {
    const result = computeBankMoatScore(strongBankMetrics.slice(0, 2), BASE_CONFIG);
    expect(result).toBeNull();
  });

  it("totalPeriods matches input length", () => {
    const result = computeBankMoatScore(strongBankMetrics, BASE_CONFIG)!;
    expect(result.totalPeriods).toBe(strongBankMetrics.length);
  });
});
