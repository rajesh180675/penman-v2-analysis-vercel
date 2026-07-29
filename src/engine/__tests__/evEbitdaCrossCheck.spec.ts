import { describe, expect, it } from "vitest";
import {
  computeEvEbitdaCrossCheck,
  updateEvEbitdaWithMarketPrice,
  EvEbitdaPeerContext,
} from "../evEbitdaCrossCheck";
import { RecastPeriod } from "../types";

const mkPeriod = (ebitda: number): RecastPeriod => {
  const TA = 1000;
  const FA = 200;
  const OA = TA - FA;
  const OL = 250;
  const NOA = OA - OL;
  const FO = 150;
  const NFO = FO - FA;
  const CSE = NOA - NFO;
  return {
    period_end: "2025-03-31",
    bs: {
      TA, CSE, MI: 0, FA, FO, OA, OL,
      OL_TradePayables: 60, OL_OtherCurrentLiabilities: 30, OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 155,
      NOA, NFO, DTL: 5, PensionObl: 0, OL_ex_DTL: OL - 5, Goodwill: 0,
      CurrentAssets: 350, CurrentLiabilities: 200, Inventory: 70, TradeReceivables: 80,
      TradePayables: 60, PPE: 200, LIFO_reserve: 0, separationScore: 85,
      OA_PPE: 200, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 70, OA_TradeReceivables: 80, OA_DTA: 0, OA_CWIP: 0,
      OA_Other: OA - 350,
    },
    is: {
      Sales: 700, TaxExpense: 25, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0,
      CNI: 90, FinanceCost: 8, FinanceIncome: 3, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 5, OI: 95, OtherItems: 0, OI_from_sales: 95, MII: 0, COGS: 450,
    },
    cu: { UOI: 0, CoreOI: 95, UFE: 0, CoreNFE: 5, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 110, Capex: 25, DividendPaid: 12, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 85, FCF_cash: 100,
      d_t: 13, d_t_formula: 13, d_t_discrepancy: 0, EBITDA: ebitda,
    },
    ratios: {
      ROCE: 0.14, RNOA: 0.17, NBC: 0.05, SPREAD: 0.12, FLEV: 0.18, PM: 0.11, ATO: 1.4,
      SalesPM: 0.11, ATO_star: 1.1, OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.05, ROOA: 0.15, OLLEV: 0.28, OLSPREAD: 0.04, RNOA_check: 0.17,
      ROTCE: 0.16, MSR: 0.1, CoreSalesPM: 0.11, CoreOtherItems_OA: 0, UOI_OA: 0,
      CoreNBC: 0.05, UFE_NFO: 0, CoreSPREAD: 0.12, ROCE_eq16_reconstructed: 0.14,
      ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
      eq16_step3_residual: 0, eq16_flag: "OK" as const, eq16_diagnosis: null,
      ROOA_spec: 0.15, imputed_io_spec: 0.05, required_return_per_sales: 0.04,
      value_creating_margin: 0.07, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
      current_ratio: 1.75, quick_ratio: 1.4, days_receivable: 38, days_payable: 30,
      days_inventory: 42, cash_conversion_cycle: 50, accrual_ratio_bs: 0.015,
      accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.88, interest_coverage: 11,
      NOA_growth: 0.03, CNI_growth: 0.04, OI_growth: 0.03, Sales_growth: 0.05,
      noaSmall: false, separationScore: 85, accrual_regime: "NORMAL" as const,
      dirty_surplus: 0, dirty_surplus_pct_cse: 0, freeOL: 0, interestBearingOL: 0,
      OLLEV_check: 0, RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    ri: { RE: 18, ReOI: 22 },
    quality: {
      piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1,
      piotroski_leverage: 1, piotroski_liquidity: 1, piotroski_dilution: 1,
      piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 8,
      beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1,
      beneish_sgai: 1, beneish_lvgi: 1, beneish_tata: 0, beneish_mscore: -2.3,
      altman_wc_ta: 0.18, altman_re_ta: 0.28, altman_ebit_ta: 0.19, altman_bve_tl: 1.9,
      altman_s_ta: 1.1, altman_zprime: 3.5,
    },
  };
};

describe("EV/EBITDA cross-check", () => {
  const peers: EvEbitdaPeerContext[] = [
    { company: "PeerA", evEbitda: 12.0 },
    { company: "PeerB", evEbitda: 14.5 },
    { company: "PeerC", evEbitda: 9.0 },
    { company: "PeerD", evEbitda: 16.0 },
    { company: "PeerE", evEbitda: 11.0 },
  ];

  it("computes peer median and quartiles", () => {
    const period =mkPeriod(130);
    const result = computeEvEbitdaCrossCheck(period, peers);

    // Sorted: [9.0, 11.0, 12.0, 14.5, 16.0]
    // Median (50th): index 2 = 12.0
    expect(result.evEbitdaMedian).toBeCloseTo(12.0, 6);
    // P25: index 1.0 = 11.0
    expect(result.evEbitdaP25).toBeCloseTo(11.0, 6);
    // P75: index 3.0 = 14.5
    expect(result.evEbitdaP75).toBeCloseTo(14.5, 6);
  });

  it("computes implied equity from median multiple", () => {
    const period =mkPeriod(130); // NFO = -50
    const result = computeEvEbitdaCrossCheck(period, peers);

    // EV from median = 130 * 12.0 = 1560
    expect(result.evFromMedian).toBeCloseTo(1560, 0);
    // Equity = EV - NFO = 1560 - (-50) = 1610
    expect(result.equityFromMedian).toBeCloseTo(1610, 0);
  });

  it("handles empty peer list", () => {
    const period =mkPeriod(130);
    const result = computeEvEbitdaCrossCheck(period, []);

    expect(result.evEbitdaMedian).toBeNull();
    expect(result.evEbitdaP25).toBeNull();
    expect(result.evFromMedian).toBeNull();
    expect(result.equityFromMedian).toBeNull();
    // This test asserted the four fields above and skipped `enterpriseValue`,
    // which was the one that did not comply: it read
    // `ebitda * (evEbitdaCompany ?? evEbitdaMedian ?? 0)`, so with no peers and
    // no market price it returned ₹0 — a valuation indistinguishable from a real
    // one — while everything around it returned null.
    expect(result.enterpriseValue).toBeNull();
  });

  it("reports the peer count, so a surface need not infer it from the label", () => {
    const period = mkPeriod(130);

    expect(computeEvEbitdaCrossCheck(period, peers).peerCount).toBe(5);
    expect(computeEvEbitdaCrossCheck(period, []).peerCount).toBe(0);
    expect(computeEvEbitdaCrossCheck(period, undefined).peerCount).toBe(0);
    // `SotpSection` had no count to render, so its "Peer count" tile rendered
    // `label` — a string beginning `EBITDA_T: 130`. The count is what the tile
    // claims to show, and the label never contained one.
    expect(computeEvEbitdaCrossCheck(period, peers).label).not.toContain("5 peers");
  });

  it("counts only the peers that reached the percentiles", () => {
    const period = mkPeriod(130);
    // A null, a zero and a negative multiple are all filtered out before the
    // median is taken, so counting the supplied array would overstate the
    // evidence behind the median by three peers.
    const result = computeEvEbitdaCrossCheck(period, [
      { company: "Real", evEbitda: 12 },
      { company: "Missing", evEbitda: null },
      { company: "Zero", evEbitda: 0 },
      { company: "Negative", evEbitda: -4 },
    ]);

    expect(result.peerCount).toBe(1);
    expect(result.evEbitdaMedian).toBeCloseTo(12, 6);
  });

  it("builds enterprise value from the peer median when there is no market price", () => {
    // The `?? 0` masked this path too: with peers but no market price the EV is
    // a real number, and the fix must not have turned it null.
    const result = computeEvEbitdaCrossCheck(mkPeriod(130), peers);

    expect(result.evEbitdaCompany).toBeNull();
    expect(result.enterpriseValue).toBeCloseTo(130 * 12.0, 6);
  });

  it("updates with market price to show company EV/EBITDA", () => {
    const period =mkPeriod(130);
    const base = computeEvEbitdaCrossCheck(period, peers);
    const marketCap = 5000;
    const updated = updateEvEbitdaWithMarketPrice(base, marketCap, period.bs.NFO);

    // EV = 5000 + (-50) = 4950
    expect(updated.enterpriseValue).toBe(4950);
    // EV/EBITDA = 4950 / 130 = 38.08
    expect(updated.evEbitdaCompany).toBeCloseTo(4950 / 130, 2);
  });

  it("includes label explaining the cross-check", () => {
    const period =mkPeriod(130);
    const result = computeEvEbitdaCrossCheck(period, peers);
    expect(result.label).toContain("EBITDA_T");
    expect(result.label).toContain("130");
  });

  it("handles negative EBITDA gracefully", () => {
    const period = mkPeriod(-20);
    const result = computeEvEbitdaCrossCheck(period, peers);

    expect(result.ebitdaT).toBe(-20);
    // Negative EBITDA means implied value is negative
    expect(result.evFromMedian).toBeLessThan(0);
  });
});
