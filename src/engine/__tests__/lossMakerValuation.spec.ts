import { describe, it, expect } from "vitest";
import { computeLossMakerValuation } from "../lossMakerValuation";
import type { RecastPeriod, EngineConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";

function mkPeriod(period_end: string, sales: number, cni: number, cfo: number, nfo = 0, cogs: number | null = null): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1500, CSE: 800, MI: 0, FA: 100, FO: 50, OA: 1300, OL: 700,
      NOA: 1200, NFO: nfo, DTL: 50, PensionObl: 0, OL_ex_DTL: 650,
      Goodwill: 0, CurrentAssets: 500, CurrentLiabilities: 300, BridgeDebtTotal: 100,
      Inventory: 100, TradeReceivables: 150, TradePayables: 100,
      PPE: 300, LIFO_reserve: 0, separationScore: 0.8,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 100,
      OL_ProvisionsCurrent: 50, OL_ProvisionsLongTerm: 50,
      OL_CurrentTaxLiabilities: 50, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 50, OL_OtherNonCurrentLiabilities: 0,
      OA_PPE: 300, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 150, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: 750,
    } as RecastPeriod["bs"],
    is: {
      Sales: sales, TaxExpense: 0, taxRate: 0.25, PAT: cni, OCI: 0, TCI: cni, TCI_NCI: 0,
      FinanceCost: 20, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 20, OI: cni - 20, OtherItems: 0, CNI: cni,
      OI_from_sales: cni - 20, MII: 0,
      COGS: cogs ?? sales * 0.6,
    } as RecastPeriod["is"],
    cu: {
      UOI: 0, CoreOI: cni - 20, UFE: 0, CoreNFE: 20,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as RecastPeriod["cu"],
    cf: {
      CFO: cfo, Capex: 30, DividendPaid: 0, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: cfo - 30, FCF_cash: cfo - 30,
      d_t: 30, d_t_formula: 30, d_t_discrepancy: 0, EBITDA: cni + 50,
    } as RecastPeriod["cf"],
    ratios: {} as RecastPeriod["ratios"],
  } as RecastPeriod;
}

const baseCfg: EngineConfig = {
  ...DEFAULT_CONFIG,
  shares_outstanding: 1_000_000_000, // 100 Cr shares
  market_price: 700,
};

describe("computeLossMakerValuation — Phase I3", () => {
  it("returns null for profitable companies", () => {
    const periods = [
      mkPeriod("2022-03-31", 5000, 600, 700),
      mkPeriod("2023-03-31", 5500, 700, 800),
      mkPeriod("2024-03-31", 6000, 800, 900),
    ];
    expect(computeLossMakerValuation(periods, baseCfg)).toBeNull();
  });

  it("returns null for fewer than 2 periods", () => {
    expect(computeLossMakerValuation([], baseCfg)).toBeNull();
    expect(computeLossMakerValuation(null, baseCfg)).toBeNull();
    expect(
      computeLossMakerValuation([mkPeriod("2024-03-31", 1000, -100, -50)], baseCfg),
    ).toBeNull();
  });

  it("classifies as loss-maker when half+ periods have CNI ≤ 0 (Paytm scenario)", () => {
    const periods = [
      mkPeriod("2022-03-31", 5000, -2400, -1500),
      mkPeriod("2023-03-31", 7000, -1700, -1100),
      mkPeriod("2024-03-31", 9000, -1400, -200, -2500), // negative NFO = net cash
      mkPeriod("2025-03-31", 11000, 90, 200, -2400),
    ];
    const result = computeLossMakerValuation(periods, baseCfg);
    expect(result).not.toBeNull();
    expect(result!.isLossMaker).toBe(true);
    expect(result!.lossYears).toBe(3);
    expect(result!.totalYears).toBe(4);
    expect(result!.latestRevenueCr).toBe(11000);
  });

  it("computes revenue growth and CAGR", () => {
    const periods = [
      mkPeriod("2022-03-31", 5000, -500, -400),
      mkPeriod("2023-03-31", 6500, -300, -200),
      mkPeriod("2024-03-31", 8500, -200, -100),
      mkPeriod("2025-03-31", 11000, -100, 50),
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.revenueGrowthYoY).toBeCloseTo((11000 - 8500) / 8500, 3);
    expect(result.revenueCAGR3y).toBeCloseTo(Math.pow(11000 / 5000, 1 / 3) - 1, 3);
  });

  it("applies sector-default multiple when no peer config", () => {
    const periods = Array.from({ length: 4 }, (_, i) =>
      mkPeriod(`${2022 + i}-03-31`, 5000 + i * 1000, -500, -100, -1000),
    );
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.revenueMultiple.source).toBe("sector-default");
    expect(result.revenueMultiple.multiple).toBe(3.0);
    expect(result.revenueMultiple.impliedEVCr).toBe(8000 * 3.0);
  });

  it("uses peer median multiple when configured", () => {
    const periods = Array.from({ length: 4 }, (_, i) =>
      mkPeriod(`${2022 + i}-03-31`, 5000 + i * 1000, -500, -100),
    );
    const cfg = { ...baseCfg, peer_median_ev_sales: 4.5 } as EngineConfig;
    const result = computeLossMakerValuation(periods, cfg)!;
    expect(result.revenueMultiple.source).toBe("config-peer-median");
    expect(result.revenueMultiple.multiple).toBe(4.5);
  });

  it("user override beats peer median", () => {
    const periods = Array.from({ length: 4 }, (_, i) =>
      mkPeriod(`${2022 + i}-03-31`, 5000 + i * 1000, -500, -100),
    );
    const cfg = {
      ...baseCfg,
      peer_median_ev_sales: 4.5,
      user_override_ev_sales: 6.0,
    } as EngineConfig;
    const result = computeLossMakerValuation(periods, cfg)!;
    expect(result.revenueMultiple.source).toBe("user-override");
    expect(result.revenueMultiple.multiple).toBe(6.0);
  });

  it("computes runway years from cash and burn", () => {
    const periods = [
      mkPeriod("2022-03-31", 5000, -500, -1000, -3000), // -3000 NFO = ₹3000 Cr net cash
      mkPeriod("2023-03-31", 6000, -400, -800, -2200),
      mkPeriod("2024-03-31", 7000, -300, -700, -1500),
      mkPeriod("2025-03-31", 8000, -200, -500, -1000), // burn slowing
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.cashBurnRateCr).not.toBeNull();
    expect(result.cashBurnRateCr).toBeGreaterThan(0);
    expect(result.runwayYears).not.toBeNull();
    expect(result.runwayYears).toBeGreaterThan(0);
  });

  it("flags green path when growth + improving margins + narrowing loss", () => {
    const periods = [
      mkPeriod("2022-03-31", 4000, -800, -700, 0, 3200), // GM ~20%
      mkPeriod("2023-03-31", 5500, -600, -500, 0, 4100), // GM ~25%
      mkPeriod("2024-03-31", 7500, -400, -200, 0, 5100), // GM ~32%
      mkPeriod("2025-03-31", 11000, -200, 100, 0, 6600), // GM ~40%, loss narrowed >70%
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.profitabilityPath.highGrowth).toBe(true);
    expect(result.profitabilityPath.improvingMargins).toBe(true);
    expect(result.profitabilityPath.narrowingLoss).toBe(true);
    expect(result.profitabilityPath.signal).toBe("green");
  });

  it("flags red path when no positive signals", () => {
    const periods = [
      mkPeriod("2022-03-31", 5000, -500, -300, 0, 4000),
      mkPeriod("2023-03-31", 4900, -550, -400, 0, 3950), // declining
      mkPeriod("2024-03-31", 4800, -600, -450, 0, 3900),
      mkPeriod("2025-03-31", 4700, -650, -500, 0, 3850),
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.profitabilityPath.signal).toBe("red");
  });

  it("reverse-DCF computes implied year-5 revenue and CAGR when market data present", () => {
    const periods = Array.from({ length: 4 }, (_, i) =>
      mkPeriod(`${2022 + i}-03-31`, 5000 + i * 1000, -500, -100),
    );
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.reverseDCF.marketCapCr).toBeCloseTo(70000, -1); // 700 × 100Cr / 1e7 in Cr
    expect(result.reverseDCF.impliedYear5Revenue).not.toBeNull();
    expect(result.reverseDCF.impliedRevenueCAGR).not.toBeNull();
    expect(result.reverseDCF.skipReason).toBeUndefined();
  });

  it("reverse-DCF skips when market data missing", () => {
    const periods = Array.from({ length: 4 }, (_, i) =>
      mkPeriod(`${2022 + i}-03-31`, 5000 + i * 1000, -500, -100),
    );
    const cfg = { ...baseCfg, market_price: undefined, shares_outstanding: undefined } as unknown as EngineConfig;
    const result = computeLossMakerValuation(periods, cfg)!;
    expect(result.reverseDCF.skipReason).toMatch(/market price/);
  });

  // Phase J4: Vodafone Idea-shaped fixture — net-debt distressed loss-maker.
  // The previous net-cash-only logic produced equity = EV - 2×NFO, which
  // collapsed to a deeply negative per-share value for net-debt names.
  it("handles net-debt loss-makers (Vodafone Idea shape) correctly", () => {
    // Vodafone Idea FY21-FY25 silhouette (heavily simplified):
    // - Sustained losses
    // - High positive NFO (net debt) ~ ₹2L Cr
    // - CFO turning negative
    // - Sales hovering ₹40-45 K Cr
    const periods = [
      mkPeriod("2021-03-31", 41000, -44000, 7000, 215000),
      mkPeriod("2022-03-31", 38000, -28000, 6000, 220000),
      mkPeriod("2023-03-31", 42000, -29000, 8500, 225000),
      mkPeriod("2024-03-31", 42500, -31000, 7500, 230000),
      mkPeriod("2025-03-31", 43500, -27000, -500, 235000), // CFO flips negative
    ];
    const cfg = { ...baseCfg, market_price: 7.5, shares_outstanding: 65_00_00_00_000 };
    const result = computeLossMakerValuation(periods, cfg)!;

    expect(result.isLossMaker).toBe(true);
    expect(result.lossYears).toBe(5);

    // Equity value = EV - NFO. With sales 43500 × 3.0 = 130500 EV and NFO 235000,
    // equity is correctly negative (huge net debt overwhelms enterprise value).
    // Critically it should be EV - NFO = 130500 - 235000 = -104500, NOT
    // EV - 2*NFO = 130500 - 470000 = -339500 (the old buggy path).
    expect(result.revenueMultiple.impliedEVCr).toBeCloseTo(43500 * 3.0, -1);
    const expectedEquityCr = 43500 * 3.0 - 235000;
    const expectedPerShare = (expectedEquityCr * 1e7) / 65_00_00_00_000;
    expect(result.revenueMultiple.perShareValue).toBeCloseTo(expectedPerShare, 2);

    // Net-debt firm: no positive cash buffer → no runway, no cashPerShare
    expect(result.cashPerShare).toBeNull();
    expect(result.runwayYears).toBeNull();
  });

  it("net-cash loss-maker (Paytm shape) still computes runway correctly", () => {
    // Same shape as before — verify no regression on the canonical net-cash case.
    // ₹2400 Cr net cash, ~₹933 Cr avg burn → ~2.6y runway
    const periods = [
      mkPeriod("2022-03-31", 5000, -2400, -1500, -3500),
      mkPeriod("2023-03-31", 7000, -1700, -1100, -2800),
      mkPeriod("2024-03-31", 9000, -1400, -200, -2500),
      mkPeriod("2025-03-31", 11000, -500, -200, -2400),
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.runwayYears).not.toBeNull();
    expect(result.runwayYears!).toBeGreaterThan(2);
    expect(result.cashPerShare).not.toBeNull();
    expect(result.cashPerShare!).toBeGreaterThan(0);

    // Equity = EV - NFO = 11000*3 - (-2400) = 33000 + 2400 = 35400
    const expectedEquityCr = 11000 * 3.0 + 2400;
    const expectedPerShare = (expectedEquityCr * 1e7) / 1_000_000_000;
    expect(result.revenueMultiple.perShareValue).toBeCloseTo(expectedPerShare, 2);
  });

  it("recommendation reflects runway pressure", () => {
    // Short runway: ₹500 Cr net cash, ₹600 Cr burn = <2y runway
    const periods = [
      mkPeriod("2022-03-31", 3000, -700, -600, -800),
      mkPeriod("2023-03-31", 3500, -650, -600, -700),
      mkPeriod("2024-03-31", 4000, -600, -600, -600),
      mkPeriod("2025-03-31", 4500, -550, -600, -500),
    ];
    const result = computeLossMakerValuation(periods, baseCfg)!;
    expect(result.runwayYears).not.toBeNull();
    expect(result.runwayYears!).toBeLessThan(2);
    expect(result.recommendation).toMatch(/runway|dilution/);
  });
});
