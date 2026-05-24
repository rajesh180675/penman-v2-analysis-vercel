import { describe, it, expect } from "vitest";
import { computeAccountingAnchor } from "../accountingAnchor";
import type { RecastPeriod } from "../types";

function buildRecastForAnchor(rnoa: number, noaSeries: number[], cse: number, nfo: number): RecastPeriod[] {
  return noaSeries.map((noa, i) => ({
    period_end: `${2020 + i}0331`,
    ratios: { RNOA: rnoa, PM: null, ATO: null, ROCE: null, NBC: null, SPREAD: null, FLEV: null, ROE: null, accrual_ratio_bs: null, accrual_ratio_cf: null },
    bs: { NOA: noa, NFO: nfo, CSE: cse, OA_Cash: 0, OA_Receivables: 0, OA_Inventory: 0, OA_OtherCurrentAssets: 0, OA_PPE: 0, OA_Intangibles: 0, OA_OtherNonCurrentAssets: 0, OL_Payables: 0, OL_OtherCurrentLiabilities: 0, OL_OtherNonCurrentLiabilities: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 0, FA_Cash: 0, FA_ShortTermInvestments: 0, FA_LongTermInvestments: 0, FL_ShortTermDebt: 0, FL_LongTermDebt: 0, FL_OtherFinancialLiabilities: 0, MinorityInterest: 0 },
    is: { Sales: 0, TaxExpense: 0, taxRate: 0.25, PAT: rnoa * noa * 0.75, OCI: 0, TCI: 0, TCI_NCI: 0, CNI: 0, FinanceCost: 0, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0, NFE: 0, OI: rnoa * noa, OtherItems: 0, OI_from_sales: 0, MII: 0, COGS: 0 },
    cf: { CFO: rnoa * noa * 0.8, Capex: 0, FCF: 0, DividendPaid: -(rnoa * noa * 0.3), CFF: 0, CFI: 0 },
    cu: { UOI: 0, CoreOI: rnoa * noa, UFE: 0, CoreNFE: 0, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    ri: { ReOI: (rnoa - 0.13) * noa, ReOI_growth: null, ReOI_margin: null, capitalCharge: 0.13 * noa },
  } as unknown as RecastPeriod));
}

describe("accountingAnchor — config-resilience guards", () => {
  it("returns a result for well-formed inputs", () => {
    const data = buildRecastForAnchor(0.20, [10000, 11000, 12100, 13300, 14600], 12600, 2000);
    const result = computeAccountingAnchor(data, 0.13, 0.60, 1500, 12.6);
    expect(result).not.toBeNull();
  });

  it("returns null when latest period RNOA is NaN (under-specified config cascade)", () => {
    // Under-specified EngineConfig cascades NaN through OI/NFE → RNOA. Engine
    // must fail closed rather than emit NaN-typed valuation outputs to the UI.
    const data = buildRecastForAnchor(NaN, [10000, 11000, 12100, 13300, 14600], 12600, 2000);
    expect(computeAccountingAnchor(data, 0.13, 0.60, 1500, 12.6)).toBeNull();
  });

  it("returns null when CSE is NaN", () => {
    const data = buildRecastForAnchor(0.20, [10000, 11000, 12100, 13300, 14600], NaN, 2000);
    expect(computeAccountingAnchor(data, 0.13, 0.60, 1500, 12.6)).toBeNull();
  });

  it("returns null when NOA is NaN", () => {
    const data = buildRecastForAnchor(0.20, [10000, 11000, 12100, 13300, NaN], 12600, 2000);
    expect(computeAccountingAnchor(data, 0.13, 0.60, 1500, 12.6)).toBeNull();
  });

  it("returns null when costOfCapital or omega is non-finite", () => {
    const data = buildRecastForAnchor(0.20, [10000, 11000, 12100, 13300, 14600], 12600, 2000);
    expect(computeAccountingAnchor(data, NaN, 0.60, 1500, 12.6)).toBeNull();
    expect(computeAccountingAnchor(data, 0.13, NaN, 1500, 12.6)).toBeNull();
    expect(computeAccountingAnchor(data, Infinity, 0.60, 1500, 12.6)).toBeNull();
  });

  it("returns null for insufficient data", () => {
    const data = buildRecastForAnchor(0.20, [10000, 11000], 12600, 2000);
    expect(computeAccountingAnchor(data, 0.13, 0.60, 1500, 12.6)).toBeNull();
  });
});
