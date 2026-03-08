import { describe, expect, it } from "vitest";
import { buildValuationPeriodsFromForecast } from "../forecastingEngine";
import { ForecastPeriod, RecastPeriod } from "../types";

function mkLatest(period_end = "2024-03-31"): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 120, FO: 80, OA: 880, OL: 280,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      NOA: 600, NFO: -40, DTL: 0, PensionObl: 0, OL_ex_DTL: 280, Goodwill: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 80, TradeReceivables: 100, TradePayables: 100,
      PPE: 240, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 240, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 80,
      OA_TradeReceivables: 100, OA_DTA: 0, OA_CWIP: 0, OA_Other: 460,
    },
    is: {
      Sales: 900, TaxExpense: 20, taxRate: 0.25, PAT: 120, OCI: 0, TCI: 120, TCI_NCI: 0,
      CNI: 120, FinanceCost: 8, FinanceIncome: 2, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 6, OI: 126, OtherItems: 0, OI_from_sales: 126, MII: 0, COGS: 500,
    },
    cu: { UOI: 0, CoreOI: 126, UFE: 0, CoreNFE: 6, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 140, Capex: 35, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 2, DividendReceived: 1, FCF_accounting: 91, FCF_cash: 105,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 150,
    },
  };
}

function mkForecast(idx: number): ForecastPeriod {
  return {
    year_offset: idx + 1,
    period_label: `FY${2025 + idx}E`,
    sales_growth_assumption: 0.1,
    core_sales_pm_assumption: 0.14,
    ato_assumption: 1.1,
    flev_assumption: 0.2,
    nbc_assumption: 0.04,
    Sales_f: 1000 + idx * 50,
    NOA_f: 700 + idx * 25,
    OI_f: 140 + idx * 10,
    NFE_f: 20 + idx * 2,
    CNI_f: 120 + idx * 8,
    CSE_f: 620 + idx * 18,
    NFO_f: 80 + idx * 7,
    ΔNOA_f: 25,
    FCF_f: 100,
    RE_f: 30,
    ReOI_f: 28,
    source: "fade",
  };
}

describe("buildValuationPeriodsFromForecast", () => {
  it("maps forecast periods into valuation-ready recast periods", () => {
    const latest = mkLatest("2024-03-31");
    const forecasts = [mkForecast(0), mkForecast(1)];

    const out = buildValuationPeriodsFromForecast(latest, forecasts);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(latest);

    expect(out[1].period_end).toBe("2025-03-31");
    expect(out[1].bs.CSE).toBe(forecasts[0].CSE_f);
    expect(out[1].bs.NOA).toBe(forecasts[0].NOA_f);
    expect(out[1].bs.NFO).toBe(forecasts[0].NOA_f - forecasts[0].CSE_f);
    expect(out[1].is.Sales).toBe(forecasts[0].Sales_f);
    expect(out[1].is.OI).toBe(forecasts[0].OI_f);
    expect(out[1].is.CNI).toBe(forecasts[0].CNI_f);
    expect(out[1].is.NFE).toBe(forecasts[0].NFE_f);

    expect(out[2].period_end).toBe("2026-03-31");
  });

  it("throws for malformed latest period_end year", () => {
    const latest = mkLatest("bad-date");
    expect(() => buildValuationPeriodsFromForecast(latest, [mkForecast(0)])).toThrow(
      "Invalid period_end year in latestPeriod: bad-date",
    );
  });
});
