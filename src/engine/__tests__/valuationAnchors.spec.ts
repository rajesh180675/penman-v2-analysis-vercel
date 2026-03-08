import { describe, expect, it } from "vitest";
import { computeValuation, deriveKwFromStructure } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";

function mkPeriod(
  period_end: string,
  values: { CSE: number; NOA: number; NFO: number; FO: number; CNI: number; OI: number; FinanceCost?: number }
): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: values.CSE,
      MI: 0,
      FA: Math.max(0, values.FO - values.NFO),
      FO: values.FO,
      OA: 900,
      OL: 250,
      OL_TradePayables: 50,
      OL_OtherCurrentLiabilities: 40,
      OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0,
      OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0,
      OL_OtherNonCurrentLiabilities: 0,
      NOA: values.NOA,
      NFO: values.NFO,
      DTL: 0,
      PensionObl: 0,
      OL_ex_DTL: 250,
      Goodwill: 0,
      CurrentAssets: 300,
      CurrentLiabilities: 200,
      Inventory: 40,
      TradeReceivables: 60,
      TradePayables: 50,
      PPE: 250,
      LIFO_reserve: 0,
      separationScore: 90,
      OA_PPE: 250,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 40,
      OA_TradeReceivables: 60,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: 550,
    },
    is: {
      Sales: 1000,
      TaxExpense: 25,
      taxRate: 0.25,
      PAT: values.CNI,
      OCI: 0,
      TCI: values.CNI,
      TCI_NCI: 0,
      CNI: values.CNI,
      FinanceCost: values.FinanceCost ?? 12,
      FinanceIncome: 2,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 6,
      OI: values.OI,
      OtherItems: 0,
      OI_from_sales: values.OI,
      MII: 0,
      COGS: 600,
    },
    cu: {
      UOI: 0,
      CoreOI: values.OI,
      UFE: 0,
      CoreNFE: 6,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 140,
      Capex: 30,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: 90,
      FCF_cash: 110,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
  };
}

describe("valuation anchor and kw guardrails", () => {
  it("uses config kd path for kw and allows kw > ke for net-cash structure", () => {
    const prev = mkPeriod("2024-03-31", { CSE: 850, NOA: 650, NFO: -200, FO: 50, CNI: 110, OI: 120 });
    const cur = mkPeriod("2025-03-31", { CSE: 900, NOA: 700, NFO: -200, FO: 40, CNI: 115, OI: 125 });
    const cfg = { ...DEFAULT_CONFIG, kd_pretax: 0.08, tax_rate_for_kd: 0.25 };
    const kw = deriveKwFromStructure(cur, prev, 0.12, 0.05, cfg);

    expect(kw).toBeGreaterThan(0.12);
    expect(kw).toBeCloseTo(0.1371, 4);
  });

  it("floors kw at risk free when structure math goes negative", () => {
    const prev = mkPeriod("2024-03-31", { CSE: 50, NOA: 1000, NFO: 4000, FO: 4100, CNI: 110, OI: 120 });
    const cur = mkPeriod("2025-03-31", { CSE: 50, NOA: 1000, NFO: 4000, FO: 4100, CNI: 115, OI: 125 });
    const cfg = { ...DEFAULT_CONFIG, kd_pretax: 0.01, tax_rate_for_kd: 0.0 };
    const kw = deriveKwFromStructure(cur, prev, 0.08, 0.06, cfg);

    expect(kw).toBe(0.06);
  });

  it("uses terminal RE/ReOI anchors when provided", () => {
    const periods: RecastPeriod[] = [
      mkPeriod("2023-03-31", { CSE: 500, NOA: 620, NFO: 120, FO: 220, CNI: 100, OI: 110 }),
      mkPeriod("2024-03-31", { CSE: 560, NOA: 670, NFO: 120, FO: 220, CNI: 120, OI: 130 }),
      mkPeriod("2025-03-31", { CSE: 620, NOA: 720, NFO: 120, FO: 220, CNI: 140, OI: 150 }),
    ];

    const out = computeValuation(periods, 0.1, 0.09, 0.03, DEFAULT_CONFIG, 40, 30);
    const rhoE = 1.1;
    const rhoW = 1.09;
    const expectedCvRe = (40 * 1.03) / (rhoE - 1 - 0.03);
    const expectedCvReOi = (30 * 1.03) / (rhoW - 1 - 0.03);

    expect(out.CV_RE).toBeCloseTo(expectedCvRe, 8);
    expect(out.CV_ReOI).toBeCloseTo(expectedCvReOi, 8);
  });
});
