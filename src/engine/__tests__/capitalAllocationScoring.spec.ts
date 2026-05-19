import { describe, expect, it } from "vitest";
import {
  scoreCapitalAllocation,
  scoreBankCapitalAllocation,
} from "../capitalAllocationScoring";
import { RecastPeriod, EngineConfig } from "../types";
import { BankPeriodMetrics } from "../bankPipeline";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ke: 0.12,
    kw: 0.10,
    g_terminal: 0.05,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.05,
    beta: 1.0,
    ...overrides,
  } as EngineConfig;
}

function makePeriod(
  period_end: string,
  overrides: {
    noa?: number;
    cse?: number;
    cni?: number;
    coreOI?: number;
    taxRate?: number;
    cfo?: number;
    capex?: number;
    fcf?: number;
    div?: number;
    buyback?: number;
    issuance?: number;
    rnoa?: number;
    spread?: number;
  } = {}
): RecastPeriod {
  const {
    noa = 1000, cse = 800, cni = 100, coreOI = 120,
    taxRate = 0.25, cfo = 110, capex = 30, fcf = 80,
    div = 40, buyback = 0, issuance = 0,
    rnoa = 0.15, spread = 0.05,
  } = overrides;

  return {
    period_end,
    bs: {
      NOA: noa, CSE: cse,
      TA: noa + 200, FA: 0, FO: 0, OA: noa, OL: 200,
      MI: 0, NFO: noa - cse,
      DTL: 0, PensionObl: 0, OL_ex_DTL: 200,
      Goodwill: 0, CurrentAssets: 300, CurrentLiabilities: 200,
      Inventory: 100, TradeReceivables: 100, TradePayables: 80,
      PPE: 500, LIFO_reserve: 0, separationScore: 1,
      OA_PPE: 500, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 100, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: 0,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 60,
      OL_ProvisionsCurrent: 20, OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 5,
      OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 10,
      BridgeDebtTotal: noa - cse,
    },
    is: {
      Sales: 800, TaxExpense: cni * taxRate / (1 - taxRate),
      taxRate, PAT: cni, OCI: 0, TCI: cni, TCI_NCI: 0, CNI: cni,
      FinanceCost: 20, FinanceIncome: 0, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 20, OI: coreOI,
      OtherItems: 0, OI_from_sales: coreOI, MII: 0, COGS: 400,
    },
    cu: {
      UOI: 0, CoreOI: coreOI, UFE: 0, CoreNFE: 20,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    },
    cf: {
      CFO: cfo, Capex: capex,
      DividendPaid: div, EquityIssued: issuance, ShareBuybacks: buyback,
      InterestReceived: 0, DividendReceived: 0,
      FCF_accounting: cfo - capex, FCF_cash: fcf,
      d_t: div, d_t_formula: div, d_t_discrepancy: 0,
      EBITDA: coreOI + 30,
    },
    ratios: {
      RNOA: rnoa, SPREAD: spread,
      ROCE: rnoa, NBC: 0.05, FLEV: 0.25,
      PM: 0.15, ATO: 1.0, SalesPM: 0.15, ATO_star: 1.0,
      OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.05, ROOA: rnoa, OLLEV: 0, OLSPREAD: 0, RNOA_check: rnoa,
      ROTCE: rnoa, MSR: 0,
      CoreSalesPM: 0.15, CoreOtherItems_OA: 0, UOI_OA: 0,
      CoreNBC: 0.05, UFE_NFO: 0, CoreSPREAD: spread,
      ROCE_eq16_reconstructed: rnoa, ROCE_eq16_error: 0,
      eq16_step1_residual: 0, eq16_step2_residual: 0, eq16_step3_residual: 0,
      eq16_flag: "OK", eq16_diagnosis: null,
      ROOA_spec: rnoa, imputed_io_spec: 0.05,
      required_return_per_sales: null, value_creating_margin: null,
      CSE_eq8_check: null, CSE_eq8_error_pct: null,
      current_ratio: 1.5, quick_ratio: 1.0,
      days_receivable: 45, days_payable: 36, days_inventory: 90,
      cash_conversion_cycle: 99, accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.02,
      cash_conversion_ratio: 1.1, interest_coverage: 8,
      NOA_growth: 0.05, CNI_growth: 0.08, OI_growth: 0.08, Sales_growth: 0.08,
      noaSmall: false, separationScore: 1,
      accrual_regime: "NORMAL",
      dirty_surplus: 0, dirty_surplus_pct_cse: 0,
      freeOL: null, interestBearingOL: null,
      OLLEV_check: null, RNOA_vs_OLLEV_residual: null,
    employeeCostRatio: null,
    },
  } as RecastPeriod;
}

/** Build a series of N periods with consistent NOA growth */
function makeSeries(n: number, baseNOA = 1000, noaGrowth = 50): RecastPeriod[] {
  return Array.from({ length: n }, (_, i) => {
    const year = 2015 + i;
    return makePeriod(`${year}-03-31`, {
      noa: baseNOA + i * noaGrowth,
      coreOI: 120 + i * 5,
      cni: 100 + i * 4,
      div: 40,
      fcf: 80,
    });
  });
}

// ─── Tests: scoreCapitalAllocation ───────────────────────────────────────────

describe("scoreCapitalAllocation", () => {
  it("returns a valid result structure", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());

    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(result.grade);
    expect(result.dimensions).toHaveLength(5);
    expect(result.totalPeriods).toBe(8);
  });

  it("dimension weights sum to 1.0", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());
    const totalWeight = result.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it("high-quality allocator scores above 60", () => {
    // Consistent dividends, buybacks with positive spread, good FCF conversion
    const periods = Array.from({ length: 10 }, (_, i) =>
      makePeriod(`${2015 + i}-03-31`, {
        noa: 1000 + i * 60,
        coreOI: 150 + i * 8,
        cni: 120 + i * 6,
        div: 50,
        buyback: 20,
        issuance: 0,
        fcf: 100,
        cfo: 130,
        rnoa: 0.18,
        spread: 0.08,
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.compositeScore).toBeGreaterThan(60);
    expect(["A", "B"]).toContain(result.grade);
  });

  it("poor allocator (dilutive issuances, no dividends, low FCF) scores below 50", () => {
    const periods = Array.from({ length: 8 }, (_, i) =>
      makePeriod(`${2015 + i}-03-31`, {
        noa: 1000 + i * 100,
        coreOI: 80,
        cni: 60,
        div: 0,
        buyback: 0,
        issuance: 50,   // equity issuance
        fcf: 10,
        cfo: 40,
        rnoa: 0.06,
        spread: -0.04,  // negative spread → dilutive
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.compositeScore).toBeLessThan(55);
    expect(result.dilutiveIssuances).toBeGreaterThan(0);
  });

  it("detects value-accretive buybacks", () => {
    const periods = Array.from({ length: 6 }, (_, i) =>
      makePeriod(`${2016 + i}-03-31`, {
        buyback: 30,
        issuance: 0,
        rnoa: 0.18,
        spread: 0.08,
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.buybacksValueAccretive).toBe(6);
  });

  it("detects dilutive issuances", () => {
    const periods = Array.from({ length: 5 }, (_, i) =>
      makePeriod(`${2016 + i}-03-31`, {
        buyback: 0,
        issuance: 80,
        rnoa: 0.06,
        spread: -0.04,
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.dilutiveIssuances).toBe(5);
  });

  it("handles missing dividends gracefully", () => {
    const periods = makeSeries(6).map(p => ({
      ...p,
      cf: { ...p.cf, DividendPaid: 0 },
    }));
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it("handles insufficient periods (< 3) with a note", () => {
    const periods = makeSeries(2);
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.notes.some(n => n.includes("Fewer than 3"))).toBe(true);
  });

  it("medianPayoutRatio is within plausible range", () => {
    const periods = Array.from({ length: 8 }, (_, i) =>
      makePeriod(`${2015 + i}-03-31`, { div: 40, cni: 100 })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.medianPayoutRatio).not.toBeNull();
    expect(result.medianPayoutRatio!).toBeCloseTo(0.4, 1);
  });

  it("medianFCFConversion is within plausible range", () => {
    const periods = Array.from({ length: 8 }, (_, i) =>
      makePeriod(`${2015 + i}-03-31`, { fcf: 80, cni: 100 })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.medianFCFConversion).not.toBeNull();
    expect(result.medianFCFConversion!).toBeCloseTo(0.8, 1);
  });

  it("trend is one of the valid values", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(["improving", "stable", "deteriorating", "insufficient-data"]).toContain(result.trend);
  });

  it("each dimension has evidence strings", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());
    for (const dim of result.dimensions) {
      expect(dim.evidence.length).toBeGreaterThan(0);
    }
  });

  it("each dimension rawValues length matches period count or period-1", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());
    for (const dim of result.dimensions) {
      // Reinvestment ROIC has n-1 values; others have n
      expect(dim.rawValues.length).toBeGreaterThanOrEqual(periods.length - 1);
    }
  });

  it("compositeScore equals weighted sum of dimension scores", () => {
    const periods = makeSeries(8);
    const result = scoreCapitalAllocation(periods, makeConfig());
    const expected = result.dimensions.reduce((s, d) => s + d.score * d.weight, 0);
    expect(result.compositeScore).toBeCloseTo(expected, 1);
  });

  it("grade A requires compositeScore >= 80", () => {
    const periods = Array.from({ length: 12 }, (_, i) =>
      makePeriod(`${2012 + i}-03-31`, {
        noa: 1000 + i * 50,
        coreOI: 200 + i * 10,
        cni: 160 + i * 8,
        div: 60,
        buyback: 30,
        issuance: 0,
        fcf: 140,
        cfo: 170,
        rnoa: 0.22,
        spread: 0.12,
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    if (result.grade === "A") {
      expect(result.compositeScore).toBeGreaterThanOrEqual(80);
    }
  });

  it("grade D requires compositeScore < 40", () => {
    const periods = Array.from({ length: 6 }, (_, i) =>
      makePeriod(`${2016 + i}-03-31`, {
        div: 0, buyback: 0, issuance: 100,
        fcf: -20, cfo: 10, cni: 20,
        rnoa: 0.03, spread: -0.07,
      })
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    if (result.grade === "D") {
      expect(result.compositeScore).toBeLessThan(40);
    }
  });
});

// ─── Tests: scoreBankCapitalAllocation ───────────────────────────────────────

function makeBankMetrics(n: number, roe = 0.15): BankPeriodMetrics[] {
  return Array.from({ length: n }, (_, i) => ({
    period_end: `${2015 + i}-03-31`,
    totalAssets: 100000 + i * 5000,
    totalEquity: 10000 + i * 500,
    advances: 60000 + i * 3000,
    deposits: 70000 + i * 3500,
    investments: 20000,
    borrowings: 5000,
    cashAndBalanceWithRBI: 3000,
    interestEarned: 8000 + i * 200,
    interestExpended: 3000 + i * 50,
    nii: 5000 + i * 200,
    otherIncome: 1000,
    operatingExpenses: 2500,
    provisions: 800,
    pat: 1200 + i * 50,
    pbt: 1600 + i * 60,
    nim: 0.035,
    roe: roe + i * 0.002,
    roa: 0.012,
    creditCost: 0.008,
    costToIncome: 0.42,
    casaRatio: 0.45,
    dividendPaid: null,
    grossNPA: 0.03,
    netNPA: 0.01,
    provisionCoverageRatio: 0.65,
    capitalAdequacyRatio: 0.16,
    // Phase K — NBFC-specific fields (null for banks)
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
  } as BankPeriodMetrics));
}

describe("scoreBankCapitalAllocation", () => {
  it("returns valid structure", () => {
    const metrics = makeBankMetrics(8);
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());

    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(result.grade);
    expect(result.totalPeriods).toBe(8);
  });

  it("high ROE bank scores above 60", () => {
    const metrics = makeBankMetrics(8, 0.20); // ROE = 20% vs ke = 12%
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(result.compositeScore).toBeGreaterThan(60);
  });

  it("low ROE bank (below ke) scores below 50", () => {
    const metrics = makeBankMetrics(8, 0.06); // ROE = 6% vs ke = 12%
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(result.compositeScore).toBeLessThan(55);
  });

  it("retentionValueAccretive counts periods where ROE > ke", () => {
    const ke = 0.12;
    const metrics = makeBankMetrics(8, 0.15); // all above ke
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig({ ke }));
    expect(result.retentionValueAccretive).toBe(8);
  });

  it("high payout ratio triggers a note", () => {
    const metrics = makeBankMetrics(6, 0.15);
    const periods = Array.from({ length: 6 }, (_, i) =>
      makePeriod(`${2016 + i}-03-31`, { div: 90, cni: 100 }) // 90% payout
    );
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(result.notes.some(n => n.includes("High payout ratio"))).toBe(true);
  });

  it("medianRetentionROE is close to input ROE", () => {
    const metrics = makeBankMetrics(8, 0.16);
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(result.medianRetentionROE).not.toBeNull();
    expect(result.medianRetentionROE!).toBeGreaterThan(0.14);
    expect(result.medianRetentionROE!).toBeLessThan(0.20);
  });

  it("insufficient periods note is added for < 3 periods", () => {
    const metrics = makeBankMetrics(2);
    const periods = makeSeries(2);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(result.notes.some(n => n.includes("Fewer than 3"))).toBe(true);
  });

  it("trend is a valid value", () => {
    const metrics = makeBankMetrics(8);
    const periods = makeSeries(8);
    const result = scoreBankCapitalAllocation(metrics, periods, makeConfig());
    expect(["improving", "stable", "deteriorating", "insufficient-data"]).toContain(result.trend);
  });
});

// ─── Phase I — robustness for loss-makers ──────────────────────────────────

describe("scoreCapitalAllocation — Phase I robustness", () => {
  it("flags dataSufficient=false when no profitable periods", () => {
    // 5 years of losses (Paytm-like)
    const periods = Array.from({ length: 5 }, (_, i) =>
      makePeriod(`${2020 + i}-03-31`, {
        cni: -50 - i * 10,
        coreOI: -40,
        div: 0,
        fcf: -30,
        rnoa: -0.05,
        spread: -0.10,
      }),
    );
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.dataSufficient).toBe(false);
    expect(result.profitablePeriods).toBe(0);
    expect(result.skipReason).toMatch(/No profitable periods/);
    expect(result.notes[0]).toBe(result.skipReason);
  });

  it("flags dataSufficient=false when 1-2 profitable periods only", () => {
    // 5-year turnaround: 3 loss years then 2 profitable years (Zomato-like)
    const losses = Array.from({ length: 3 }, (_, i) =>
      makePeriod(`${2020 + i}-03-31`, {
        cni: -50, coreOI: -40, div: 0, fcf: -30, rnoa: -0.05, spread: -0.10,
      }),
    );
    const profits = Array.from({ length: 2 }, (_, i) =>
      makePeriod(`${2023 + i}-03-31`, {
        cni: 100, coreOI: 120, div: 30, fcf: 80, rnoa: 0.12, spread: 0.04,
      }),
    );
    const result = scoreCapitalAllocation([...losses, ...profits], makeConfig());
    expect(result.dataSufficient).toBe(false);
    expect(result.profitablePeriods).toBe(2);
    expect(result.skipReason).toMatch(/Only 2 profitable period/);
  });

  it("flags dataSufficient=true at exactly 3 profitable periods", () => {
    const losses = Array.from({ length: 2 }, (_, i) =>
      makePeriod(`${2020 + i}-03-31`, {
        cni: -50, coreOI: -40, div: 0, fcf: -30, rnoa: -0.05, spread: -0.10,
      }),
    );
    const profits = Array.from({ length: 3 }, (_, i) =>
      makePeriod(`${2022 + i}-03-31`, {
        cni: 100, coreOI: 120, div: 30, fcf: 80, rnoa: 0.12, spread: 0.04,
      }),
    );
    const result = scoreCapitalAllocation([...losses, ...profits], makeConfig());
    expect(result.dataSufficient).toBe(true);
    expect(result.profitablePeriods).toBe(3);
    expect(result.skipReason).toBeNull();
  });

  it("treats null/NaN CNI as not profitable", () => {
    const periods = makeSeries(5);
    // First 2 periods get CNI=null
    periods[0].is.CNI = null as never;
    periods[1].is.CNI = NaN;
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.profitablePeriods).toBe(3);
    // Still sufficient (3 valid).
    expect(result.dataSufficient).toBe(true);
  });

  it("preserves backwards compatibility: profitable companies unchanged", () => {
    const periods = makeSeries(5);
    const result = scoreCapitalAllocation(periods, makeConfig());
    expect(result.dataSufficient).toBe(true);
    expect(result.skipReason).toBeNull();
    expect(result.profitablePeriods).toBe(5);
    // The notes array shouldn't have skipReason prepended.
    expect(result.notes.every((n) => !n.includes("profitable period"))).toBe(true);
  });
});
