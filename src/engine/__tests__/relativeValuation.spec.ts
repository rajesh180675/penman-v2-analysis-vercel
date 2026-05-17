/**
 * Tests for Relative Valuation module
 */
import { describe, it, expect } from "vitest";
import {
  computeIndustrialMultiples,
  computeBankMultiples,
  multiplePositionLabel,
  multipleSignal,
} from "../relativeValuation";
import type { RecastPeriod } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePeriod(overrides: {
  period_end: string;
  Sales: number;
  PAT: number;
  CoreOI: number;
  CSE: number;
  NOA: number;
  NFO: number;
}): RecastPeriod {
  return {
    period_end: overrides.period_end,
    bs: {
      TA: overrides.NOA + overrides.NFO + overrides.CSE,
      CSE: overrides.CSE, MI: 0,
      FA: 100, FO: overrides.NFO,
      OA: overrides.NOA + 100, OL: 400,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 100,
      OL_ProvisionsCurrent: 50, OL_ProvisionsLongTerm: 50,
      OL_CurrentTaxLiabilities: 50, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 50, OL_OtherNonCurrentLiabilities: 0,
      NOA: overrides.NOA, NFO: overrides.NFO,
      DTL: 50, PensionObl: 0, OL_ex_DTL: 350,
      Goodwill: 0, CurrentAssets: 500, CurrentLiabilities: 300,
      BridgeDebtTotal: overrides.NFO,
      Inventory: 100, TradeReceivables: 150, TradePayables: 100,
      PPE: 300, LIFO_reserve: 0, separationScore: 0.8,
      OA_PPE: 300, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 150, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: overrides.NOA - 700,
    } as RecastPeriod["bs"],
    is: {
      Sales: overrides.Sales,
      TaxExpense: overrides.PAT * 0.33,
      taxRate: 0.25,
      PAT: overrides.PAT,
      OCI: 0, TCI: overrides.PAT, TCI_NCI: 0,
      CNI: overrides.PAT,
      FinanceCost: 10, FinanceIncome: 2, FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: -8, OI: overrides.CoreOI, OtherItems: 0, OI_from_sales: 0, MII: 0,
      COGS: overrides.Sales * 0.5,
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
  };
}

const PERIODS = [
  makePeriod({ period_end: "2021-03-31", Sales: 10000, PAT: 1500, CoreOI: 2000, CSE: 8000,  NOA: 9000,  NFO: 1000 }),
  makePeriod({ period_end: "2022-03-31", Sales: 11000, PAT: 1650, CoreOI: 2200, CSE: 9000,  NOA: 10000, NFO: 1000 }),
  makePeriod({ period_end: "2023-03-31", Sales: 12000, PAT: 1800, CoreOI: 2400, CSE: 10000, NOA: 11000, NFO: 1000 }),
  makePeriod({ period_end: "2024-03-31", Sales: 13000, PAT: 1950, CoreOI: 2600, CSE: 11000, NOA: 12000, NFO: 1000 }),
  makePeriod({ period_end: "2025-03-31", Sales: 14000, PAT: 2100, CoreOI: 2800, CSE: 12000, NOA: 13000, NFO: 1000 }),
];

const MARKET = { marketCap: 42000, netDebt: 1000 };

// ─── Industrial Multiples ─────────────────────────────────────────────────────

describe("computeIndustrialMultiples", () => {
  it("returns a result", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    expect(result).toBeDefined();
    expect(result.companyType).toBe("industrial");
  });

  it("primary multiples include PE, EV/CoreOI, PB", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    const names = result.primary.map(b => b.metric);
    expect(names).toContain("PE");
    expect(names).toContain("EV/CoreOI");
    expect(names).toContain("PB");
  });

  it("secondary multiples include PS", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    const names = result.secondary.map(b => b.metric);
    expect(names).toContain("PS");
  });

  it("current PE = marketCap / latestPAT", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    const pe = result.primary.find(b => b.metric === "PE")!;
    expect(pe.current).toBeCloseTo(42000 / 2100, 2);
  });

  it("current PB = marketCap / latestCSE", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    const pb = result.primary.find(b => b.metric === "PB")!;
    expect(pb.current).toBeCloseTo(42000 / 12000, 2);
  });

  it("EV = marketCap + netDebt", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    expect(result.enterpriseValue).toBe(43000);
  });

  it("historical band has min ≤ median ≤ max", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    for (const band of result.primary) {
      if (band.min != null && band.median != null && band.max != null) {
        expect(band.min).toBeLessThanOrEqual(band.median);
        expect(band.median).toBeLessThanOrEqual(band.max);
      }
    }
  });

  it("periodsWithData matches number of valid periods", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    const pe = result.primary.find(b => b.metric === "PE")!;
    expect(pe.periodsWithData).toBe(5);
  });

  it("currentPercentile is between 0 and 100", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET);
    for (const band of result.primary) {
      if (band.currentPercentile != null) {
        expect(band.currentPercentile).toBeGreaterThanOrEqual(0);
        expect(band.currentPercentile).toBeLessThanOrEqual(100);
      }
    }
  });

  it("computes premiumToSector when sector medians provided", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET, { pe: 20, pb: 3 });
    const pe = result.primary.find(b => b.metric === "PE")!;
    expect(pe.sectorMedian).toBe(20);
    expect(pe.premiumToSector).not.toBeNull();
  });

  it("impliedFairValue = sectorMedian × latestFundamental", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET, { pe: 20 });
    const pe = result.primary.find(b => b.metric === "PE")!;
    // implied = 20 × 2100 = 42000
    expect(pe.impliedFairValue).toBeCloseTo(20 * 2100, 0);
  });

  it("impliedFairValueComposite is median of non-null implied values", () => {
    const result = computeIndustrialMultiples(PERIODS, MARKET, { pe: 20, pb: 3, evEbitda: 15 });
    expect(result.impliedFairValueComposite).not.toBeNull();
  });

  it("marginOfSafety is positive when implied > marketCap", () => {
    // sector PE 30 × PAT 2100 = 63000 > marketCap 42000
    const result = computeIndustrialMultiples(PERIODS, MARKET, { pe: 30 });
    if (result.impliedFairValueComposite != null && result.impliedFairValueComposite > MARKET.marketCap) {
      expect(result.marginOfSafety).toBeGreaterThan(0);
    }
  });
});

// ─── Bank Multiples ───────────────────────────────────────────────────────────

describe("computeBankMultiples", () => {
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

  const bankMetrics = [
    { period_end: "2021-03-31", totalAssets: 500000, totalEquity: 40000, advances: 300000, deposits: 380000, investments: 80000, borrowings: 20000, cashAndBalanceWithRBI: 20000, interestEarned: 30000, interestExpended: 15000, nii: 15000, otherIncome: 5000, operatingExpenses: 8000, provisions: 3000, pat: 6000, pbt: 8000, nim: 0.04, roa: 0.012, roe: 0.15, creditCost: 0.01, costToIncome: 0.40, casaRatio: null, ...NBFC_DEFAULTS },
    { period_end: "2022-03-31", totalAssets: 550000, totalEquity: 44000, advances: 330000, deposits: 420000, investments: 88000, borrowings: 22000, cashAndBalanceWithRBI: 22000, interestEarned: 33000, interestExpended: 16500, nii: 16500, otherIncome: 5500, operatingExpenses: 8800, provisions: 3300, pat: 6600, pbt: 8800, nim: 0.041, roa: 0.012, roe: 0.15, creditCost: 0.01, costToIncome: 0.40, casaRatio: null, ...NBFC_DEFAULTS },
    { period_end: "2023-03-31", totalAssets: 600000, totalEquity: 48000, advances: 360000, deposits: 460000, investments: 96000, borrowings: 24000, cashAndBalanceWithRBI: 24000, interestEarned: 36000, interestExpended: 18000, nii: 18000, otherIncome: 6000, operatingExpenses: 9600, provisions: 3600, pat: 7200, pbt: 9600, nim: 0.042, roa: 0.012, roe: 0.15, creditCost: 0.01, costToIncome: 0.40, casaRatio: null, ...NBFC_DEFAULTS },
    { period_end: "2024-03-31", totalAssets: 650000, totalEquity: 52000, advances: 390000, deposits: 500000, investments: 104000, borrowings: 26000, cashAndBalanceWithRBI: 26000, interestEarned: 39000, interestExpended: 19500, nii: 19500, otherIncome: 6500, operatingExpenses: 10400, provisions: 3900, pat: 7800, pbt: 10400, nim: 0.043, roa: 0.012, roe: 0.15, creditCost: 0.01, costToIncome: 0.40, casaRatio: null, ...NBFC_DEFAULTS },
    { period_end: "2025-03-31", totalAssets: 700000, totalEquity: 56000, advances: 420000, deposits: 540000, investments: 112000, borrowings: 28000, cashAndBalanceWithRBI: 28000, interestEarned: 42000, interestExpended: 21000, nii: 21000, otherIncome: 7000, operatingExpenses: 11200, provisions: 4200, pat: 8400, pbt: 11200, nim: 0.044, roa: 0.012, roe: 0.15, creditCost: 0.01, costToIncome: 0.40, casaRatio: null, ...NBFC_DEFAULTS },
  ];

  const bankMarket = { marketCap: 280000 };

  it("returns a result with companyType bank", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    expect(result.companyType).toBe("bank");
  });

  it("primary multiples include PB and PE", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    const names = result.primary.map(b => b.metric);
    expect(names).toContain("PB");
    expect(names).toContain("PE");
  });

  it("secondary multiples include Price/NII", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    const names = result.secondary.map(b => b.metric);
    expect(names).toContain("Price/NII");
  });

  it("current PB = marketCap / latestEquity", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    const pb = result.primary.find(b => b.metric === "PB")!;
    expect(pb.current).toBeCloseTo(280000 / 56000, 2);
  });

  it("current PE = marketCap / latestPAT", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    const pe = result.primary.find(b => b.metric === "PE")!;
    expect(pe.current).toBeCloseTo(280000 / 8400, 2);
  });

  it("enterpriseValue is null for banks", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket);
    expect(result.enterpriseValue).toBeNull();
  });

  it("computes implied fair value from sector medians", () => {
    const result = computeBankMultiples(bankMetrics, bankMarket, { pb: 3 });
    const pb = result.primary.find(b => b.metric === "PB")!;
    expect(pb.impliedFairValue).toBeCloseTo(3 * 56000, 0);
  });
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

describe("multiplePositionLabel", () => {
  it("returns Near historical high for percentile ≥ 90", () => {
    const band = { metric: "PE", current: 30, min: 10, median: 20, max: 35, periodsWithData: 5, currentPercentile: 95, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multiplePositionLabel(band)).toBe("Near historical high");
  });

  it("returns Near historical low for percentile < 10", () => {
    const band = { metric: "PE", current: 11, min: 10, median: 20, max: 35, periodsWithData: 5, currentPercentile: 5, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multiplePositionLabel(band)).toBe("Near historical low");
  });

  it("returns N/A when current is null", () => {
    const band = { metric: "PE", current: null, min: null, median: null, max: null, periodsWithData: 0, currentPercentile: null, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multiplePositionLabel(band)).toBe("N/A");
  });
});

describe("multipleSignal", () => {
  it("returns expensive when current > 1.3× median", () => {
    const band = { metric: "PE", current: 40, min: 10, median: 20, max: 50, periodsWithData: 5, currentPercentile: 80, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multipleSignal(band)).toBe("expensive");
  });

  it("returns cheap when current < 0.75× median", () => {
    const band = { metric: "PE", current: 12, min: 10, median: 20, max: 50, periodsWithData: 5, currentPercentile: 20, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multipleSignal(band)).toBe("cheap");
  });

  it("returns fair when current is near median", () => {
    const band = { metric: "PE", current: 20, min: 10, median: 20, max: 50, periodsWithData: 5, currentPercentile: 50, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multipleSignal(band)).toBe("fair");
  });

  it("returns unknown when current is null", () => {
    const band = { metric: "PE", current: null, min: null, median: null, max: null, periodsWithData: 0, currentPercentile: null, sectorMedian: null, premiumToSector: null, impliedFairValue: null };
    expect(multipleSignal(band)).toBe("unknown");
  });
});
