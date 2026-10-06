/**
 * Carving a consolidated lending arm out of its industrial parent: built from
 * a known industrial business and a known arm, the consolidated periods must
 * carve back to the industrial business exactly.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import type { SegmentData } from "../../segmentParser";
import { carveOutLendingArm, type ArmInsuranceLines } from "../carveOut";
import { valueArmStake } from "../armValuation";
import { applyLendingArmCarveOut, valuationPeriodsWithArmCarvedOut, withoutSegment } from "..";
import type { ArmFiling, LendingArmLink } from "../links";

const T = 0.25;
const STAKE = 0.6;

interface Industrial { OA: number; FA: number; OL: number; FO: number; MI: number; Sales: number; OI: number; FinanceCost: number; MII: number; CFO: number }
interface Arm { A: number; L: number; revenue: number; pbt: number; dep: number }
/** The arm's composition in every year: what its filing says and what the carve uses. */
const FA_SHARE = 0.1;
const FO_SHARE = 0.95;
const FC_RATE = 0.07;

const armFC = (arm: Arm) => FC_RATE * FO_SHARE * arm.L;

function consolidated(periodEnd: string, ind: Industrial, arm: Arm | null, prior?: RecastPeriod): RecastPeriod {
  const a = arm ?? { A: 0, L: 0, revenue: 0, pbt: 0, dep: 0 };
  const fc = arm ? armFC(arm) : 0;
  const armPat = a.pbt * (1 - T);
  const OA = ind.OA + (1 - FA_SHARE) * a.A;
  const FA = ind.FA + FA_SHARE * a.A;
  const OL = ind.OL + (1 - FO_SHARE) * a.L;
  const FO = ind.FO + FO_SHARE * a.L;
  const armEquity = a.A - a.L;
  const NOA = OA - OL;
  const NFO = FO - FA;
  const MI = ind.MI + (1 - STAKE) * armEquity;
  const CSE = NOA - NFO - MI;
  const NFEind = ind.FinanceCost * (1 - T);
  const OI = ind.OI + (a.pbt + fc) * (1 - T);
  const NFE = NFEind + fc * (1 - T);
  const MII = ind.MII + (1 - STAKE) * armPat;
  const CNI = OI - NFE - MII;
  return {
    period_end: periodEnd,
    bs: {
      TA: OA + FA, CSE, MI, FA, FO, OA, OL, NOA, NFO,
      FO_FinancialDebtExLease: FO,
      OL_TradePayables: OL * 0.5, OL_OtherCurrentLiabilities: OL * 0.5, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      DTL: 0, PensionObl: 0, OL_ex_DTL: OL, Goodwill: 500,
      CurrentAssets: OA * 0.4, CurrentLiabilities: OL * 0.6, Inventory: 800, TradeReceivables: 900, TradePayables: OL * 0.5,
      PPE: 3000, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 3000, OA_ROU: 0, OA_Goodwill: 500, OA_OtherIntangibles: 200, OA_Inventory: 800, OA_TradeReceivables: 900,
      OA_DTA: 0, OA_CWIP: 0, OA_Other: OA - 3000 - 500 - 200 - 800 - 900,
    },
    is: {
      Sales: ind.Sales + a.revenue, TaxExpense: 0, taxRate: T, PAT: CNI + MII, OCI: 0, TCI: CNI, TCI_NCI: -MII, CNI,
      FinanceCost: ind.FinanceCost + fc, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE, OI, OtherItems: 0, OI_from_sales: OI, MII, COGS: ind.Sales * 0.5,
    },
    cu: { UOI: 0, CoreOI: OI, UFE: 0, CoreNFE: NFE, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: ind.CFO + (arm ? armPat + a.dep : 0), Capex: 400, DividendPaid: 300, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 0, FCF_cash: 0, d_t: 300, d_t_formula: 0, d_t_discrepancy: 0,
      EBITDA: OI / (1 - T) + 300 + a.dep,
    },
    ratios: prior ? ({ RNOA: 0.2 } as RecastPeriod["ratios"]) : undefined,
    spec_flags: [],
  } as RecastPeriod;
}

const industrial = (scale: number): Industrial => ({
  OA: 20_000 * scale, FA: 4_000 * scale, OL: 6_000 * scale, FO: 2_000 * scale, MI: 1_000 * scale,
  Sales: 30_000 * scale, OI: 3_000 * scale, FinanceCost: 150 * scale, MII: 100 * scale, CFO: 3_500 * scale,
});
const ARM_FY24: Arm = { A: 50_000, L: 42_000, revenue: 6_000, pbt: 1_200, dep: 50 };
const ARM_FY25: Arm = { A: 60_000, L: 51_000, revenue: 7_200, pbt: 1_500, dep: 60 };

function filing(fiscalYearEnd: string, arm: Arm, extra: { profit?: number } = {}): ArmFiling {
  const loans = (1 - FA_SHARE) * arm.A;
  const payables = (1 - FO_SHARE) * arm.L;
  return {
    fiscalYearEnd,
    filingDate: `${fiscalYearEnd.slice(0, 4)}-05-01`,
    xbrlUrl: `https://example.test/${fiscalYearEnd}.xml`,
    headline: { revenue: arm.revenue, profitBeforeTax: arm.pbt, profitAfterTax: arm.pbt * (1 - T), profitAttributableToOwners: extra.profit ?? arm.pbt * (1 - T), financeCosts: armFC(arm) },
    lenderBalanceSheet: {
      financialAssets: arm.A, nonFinancialAssets: 0, loans, receivables: 0,
      financialLiabilities: arm.L, nonFinancialLiabilities: 0, payables, ownersEquity: arm.A - arm.L,
    },
  };
}

function segments(rows: Record<string, Arm>): SegmentData {
  const data: SegmentData["data"] = { "FINANCIAL SERVICES": {}, "ENGINEERING": {} };
  for (const [fy, arm] of Object.entries(rows)) {
    data["FINANCIAL SERVICES"]![fy] = { revenue: arm.revenue, interSegmentRevenue: 0, result: arm.pbt, assets: arm.A, liabilities: arm.L, capex: 10, depreciation: arm.dep, nonCashExpenditure: null };
    data["ENGINEERING"]![fy] = { revenue: 30_000, interSegmentRevenue: 0, result: 4_000, assets: 24_000, liabilities: 8_000, capex: 400, depreciation: 300, nonCashExpenditure: null };
  }
  return { segmentationType: "business", segments: ["FINANCIAL SERVICES", "ENGINEERING"], years: Object.keys(rows), data, unallocated: {} } as unknown as SegmentData;
}

const link = (filings: ArmFiling[]): LendingArmLink => ({
  parentTicker: "TEST",
  segmentName: "FINANCIAL SERVICES",
  arm: { name: "Test Finance", nseSymbol: "TESTFIN" },
  stake: { fraction: STAKE, asOf: "2025-03-31", source: "test" },
  filings,
});

const noInsurance = new Map<string, ArmInsuranceLines>();
const config = { ...DEFAULT_CONFIG, company_type: "industrial" as const };

describe("carveOutLendingArm", () => {
  const fy24 = consolidated("2024-03-31", industrial(1), ARM_FY24);
  const fy25 = consolidated("2025-03-31", industrial(1.1), ARM_FY25, fy24);
  const filings = [filing("2024-03-31", ARM_FY24), filing("2025-03-31", ARM_FY25)];

  it("carves the consolidated periods back to the industrial business", () => {
    const carve = carveOutLendingArm({
      periods: [fy24, fy25], segmentData: segments({ FY2024: ARM_FY24, FY2025: ARM_FY25 }), link: link(filings), insuranceLines: noInsurance, config,
    });
    expect(carve.status).toBe("applied");
    if (carve.status !== "applied") return;
    for (const [period, ind] of [[carve.periods[0]!, industrial(1)], [carve.periods[1]!, industrial(1.1)]] as const) {
      expect(period.bs.NOA).toBeCloseTo(ind.OA - ind.OL, 6);
      expect(period.bs.NFO).toBeCloseTo(ind.FO - ind.FA, 6);
      expect(period.bs.MI).toBeCloseTo(ind.MI, 6);
      expect(period.bs.CSE).toBeCloseTo(ind.OA - ind.OL - (ind.FO - ind.FA) - ind.MI, 6);
      expect(period.is.Sales).toBeCloseTo(ind.Sales, 6);
      expect(period.is.OI).toBeCloseTo(ind.OI, 6);
      expect(period.is.NFE).toBeCloseTo(ind.FinanceCost * (1 - T), 6);
      expect(period.is.MII).toBeCloseTo(ind.MII, 6);
      expect(period.is.CNI).toBeCloseTo(ind.OI - ind.FinanceCost * (1 - T) - ind.MII, 6);
      // The industrial identity still holds without the arm.
      expect(period.bs.NOA - period.bs.NFO).toBeCloseTo(period.bs.CSE + period.bs.MI, 6);
      expect(period.lendingArm?.source).toBe("parent-segment");
    }
    // Ratios are recomputed against the carved predecessor; the first carved year has none.
    expect(carve.periods[0]!.ratios).toBeUndefined();
    expect(carve.periods[1]!.ratios?.RNOA).toBeCloseTo(industrial(1.1).OI / ((industrial(1).OA - industrial(1).OL + industrial(1.1).OA - industrial(1.1).OL) / 2), 4);
  });

  it("takes the arm's cash flow from its own balance sheets", () => {
    const carve = carveOutLendingArm({
      periods: [fy24, fy25], segmentData: segments({ FY2024: ARM_FY24, FY2025: ARM_FY25 }), link: link(filings), insuranceLines: noInsurance, config,
    });
    if (carve.status !== "applied") throw new Error("not applied");
    const armNoa = (arm: Arm) => (1 - FA_SHARE) * arm.A - (1 - FO_SHARE) * arm.L;
    const armCfo = ARM_FY25.pbt * (1 - T) + ARM_FY25.dep - (armNoa(ARM_FY25) - armNoa(ARM_FY24));
    expect(carve.arm[1]!.cashFromOperations).toBeCloseTo(armCfo, 6);
    expect(carve.periods[1]!.cf.CFO).toBeCloseTo(fy25.cf.CFO - armCfo, 6);
    expect(carve.periods[1]!.cf.FCF_cash).toBeCloseTo(carve.periods[1]!.cf.CFO - carve.periods[1]!.cf.Capex, 6);
    expect(carve.notes).toEqual(["2024-03-31: no prior carved year, so Test Finance's operating cash flow is its profit plus depreciation."]);
  });

  it("drops the years it cannot carve from the front of the series, each with why", () => {
    // FY23: the parent holds too little in FA for the arm's financial assets.
    const thin = consolidated("2023-03-31", { ...industrial(0.9), FA: 0 }, ARM_FY24);
    const fy23 = { ...thin, bs: { ...thin.bs, FA: 1_000, TA: thin.bs.OA + 1_000, NFO: thin.bs.FO - 1_000, CSE: thin.bs.NOA - (thin.bs.FO - 1_000) - thin.bs.MI } };
    const carve = carveOutLendingArm({
      periods: [fy23, fy24, fy25], segmentData: segments({ FY2023: ARM_FY24, FY2024: ARM_FY24, FY2025: ARM_FY25 }), link: link(filings), insuranceLines: noInsurance, config,
    });
    if (carve.status !== "applied") throw new Error("not applied");
    expect(carve.periods.map((p) => p.period_end)).toEqual(["2024-03-31", "2025-03-31"]);
    expect(carve.droppedPeriods).toHaveLength(1);
    expect(carve.droppedPeriods[0]).toMatch(/^2023-03-31: removing the arm leaves a negative balance \(FA -4000/);
  });

  it("is not applied when the latest year cannot be carved", () => {
    const carve = carveOutLendingArm({
      periods: [fy24, fy25], segmentData: segments({ FY2024: ARM_FY24 }), link: link([filing("2024-03-31", ARM_FY24)]), insuranceLines: noInsurance, config,
    });
    expect(carve).toEqual({ status: "not-applied", reason: "2025-03-31: no FINANCIAL SERVICES segment and no filing of Test Finance." });
  });

  it("falls back to the arm's own filing in a year the segment note does not reach", () => {
    const carve = carveOutLendingArm({
      periods: [fy24, fy25], segmentData: segments({ FY2024: ARM_FY24 }), link: link(filings), insuranceLines: noInsurance, config,
    });
    if (carve.status !== "applied") throw new Error("not applied");
    expect(carve.arm.map((a) => a.source)).toEqual(["parent-segment", "arm-filing"]);
    expect(carve.periods[1]!.bs.NOA).toBeCloseTo(industrial(1.1).OA - industrial(1.1).OL, 6);
  });

  it("takes the parent's consolidation excess on the arm from goodwill and intangibles first", () => {
    // The segment reports 400 more assets (and equity) than the arm's own books.
    const withExcess = { ...ARM_FY25, A: ARM_FY25.A + 400 };
    const parent = consolidated("2025-03-31", industrial(1.1), withExcess, fy24);
    const carve = carveOutLendingArm({
      periods: [parent], segmentData: segments({ FY2025: withExcess }), link: link([filing("2025-03-31", ARM_FY25)]), insuranceLines: noInsurance, config,
    });
    if (carve.status !== "applied") throw new Error("not applied");
    expect(carve.arm[0]!.consolidationExcess).toBe(400);
    expect(carve.periods[0]!.bs.OA_Goodwill).toBe(100);
    expect(carve.periods[0]!.bs.OA_OtherIntangibles).toBe(200);
  });

  it("splits an arm with an insurer on the parent's own insurance lines", () => {
    // 20,000 of the arm's investments back policies the parent files on its own
    // line (held in OA), and 18,000 of its liabilities are policy liabilities (OL).
    const insurance = new Map([["2025-03-31", { investments: 20_000, liabilities: 18_000 }]]);
    const arm = { A: 80_000, L: 69_000, revenue: 9_000, pbt: 1_800, dep: 70 };
    const fa = FA_SHARE * (arm.A - 20_000);
    const fo = FO_SHARE * (arm.L - 18_000);
    const ind = industrial(1.1);
    const parent = consolidated("2025-03-31", ind, null);
    const bs = { ...parent.bs };
    bs.OA += arm.A - fa; bs.OA_Other += arm.A - fa; bs.FA += fa; bs.OL += arm.L - fo; bs.FO += fo;
    bs.TA = bs.OA + bs.FA; bs.NOA = bs.OA - bs.OL; bs.NFO = bs.FO - bs.FA; bs.MI += (1 - STAKE) * (arm.A - arm.L); bs.CSE = bs.NOA - bs.NFO - bs.MI;
    const armFiling: ArmFiling = {
      ...filing("2025-03-31", arm),
      lenderBalanceSheet: {
        financialAssets: arm.A, nonFinancialAssets: 0, loans: (1 - FA_SHARE) * (arm.A - 20_000), receivables: 0,
        financialLiabilities: arm.L, nonFinancialLiabilities: 0, payables: (1 - FO_SHARE) * (arm.L - 18_000), ownersEquity: arm.A - arm.L,
      },
    };
    const carve = carveOutLendingArm({
      periods: [{ ...parent, bs }], segmentData: segments({ FY2025: arm }), link: link([armFiling]), insuranceLines: insurance, config,
    });
    if (carve.status !== "applied") throw new Error("not applied");
    expect(carve.arm[0]!.financialAssets).toBeCloseTo(fa, 6);
    expect(carve.arm[0]!.financialObligations).toBeCloseTo(fo, 6);
    expect(carve.periods[0]!.bs.FA).toBeCloseTo(ind.FA, 6);
    expect(carve.periods[0]!.bs.NOA).toBeCloseTo(ind.OA - ind.OL, 6);
  });
});

describe("valueArmStake", () => {
  const arm = (periodEnd: string, a: Arm) => ({
    periodEnd, source: "parent-segment" as const, assets: a.A, liabilities: a.L, revenue: a.revenue, profitBeforeTax: a.pbt,
    depreciation: a.dep, capex: 0, financialAssets: 0, operatingAssets: a.A, consolidationExcess: 0, financialObligations: a.L,
    operatingLiabilities: 0, financeCost: 0, taxRate: T, profitAfterTax: a.pbt * (1 - T), parentShare: STAKE,
    composition: { fiscalYearEnd: periodEnd, filingDate: periodEnd }, cashFromOperations: 0,
  });
  const years = ["2021-03-31", "2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31"];
  const filings = years.map((fy, i) => filing(fy, { A: 40_000 + i * 5_000, L: 34_000 + i * 4_200, revenue: 5_000, pbt: 1_000 + i * 100, dep: 40 }));

  it("values the stake on the arm's own filings to the year end, at book where no filing dates it", () => {
    const stakes = valueArmStake({ arm: [arm("2020-03-31", ARM_FY24), arm("2025-03-31", ARM_FY25)], link: link(filings) });
    expect(stakes[0]).toMatchObject({ basis: "book", armValue: null, filedYears: [], stakeValue: STAKE * (ARM_FY24.A - ARM_FY24.L) });
    expect(stakes[1]!.basis).toBe("lender-valuation");
    expect(stakes[1]!.filedYears).toEqual(years);
    expect(stakes[1]!.armBookEquity).toBe(60_000 - 50_800);
    expect(stakes[1]!.stakeValue).toBeCloseTo(STAKE * stakes[1]!.armValue!, 6);
  });
});

describe("applyLendingArmCarveOut", () => {
  it("does nothing for a parent with no linked arm", () => {
    expect(applyLendingArmCarveOut({ ticker: "TCS", periods: [], rawData: [], segmentData: null, config })).toBeNull();
    const basis = valuationPeriodsWithArmCarvedOut({ ticker: "TCS", periods: [], rawData: [], segmentData: null, config });
    expect(basis).toEqual({ periods: [], lendingArm: null });
  });

  it("removes a carved segment from the set a SOTP sums", () => {
    const set = withoutSegment(segments({ FY2025: ARM_FY25 }), "FINANCIAL SERVICES");
    expect(set.segments).toEqual(["ENGINEERING"]);
    expect(Object.keys(set.data)).toEqual(["ENGINEERING"]);
  });
});
