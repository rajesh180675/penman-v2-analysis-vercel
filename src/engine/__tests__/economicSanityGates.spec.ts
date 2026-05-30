import { describe, expect, it } from "vitest";
import {
  evaluateEconomicSanity,
  MAX_ANCHOR_LOOKBACK_PERIODS,
  RNOA_JUMP_THRESHOLD,
  type UnusualItemManifestLike,
} from "../economicSanityGates";
import { RawPeriodData, RecastPeriod } from "../types";

function mkRecastPeriod(
  period_end: string,
  overrides: {
    cse?: number;
    rnoa?: number | null;
    buyback?: number;
    issuance?: number;
    cni?: number;
    oci?: number;
    cfo?: number;
    capex?: number;
  } = {},
): RecastPeriod {
  const cse = overrides.cse ?? 1000;
  return {
    period_end,
    bs: {
      TA: 1500, CSE: cse, MI: 0, FA: 100, FO: 200, OA: 1300, OL: 200,
      OL_TradePayables: 50, OL_OtherCurrentLiabilities: 50, OL_ProvisionsCurrent: 20,
      OL_ProvisionsLongTerm: 20, OL_CurrentTaxLiabilities: 20, OL_NonCurrentTaxLiabilities: 20,
      OL_DeferredTaxLiabilitiesNet: 10, OL_OtherNonCurrentLiabilities: 10,
      NOA: 1100, NFO: 100, DTL: 10, PensionObl: 0, OL_ex_DTL: 190,
      Goodwill: 0, CurrentAssets: 400, CurrentLiabilities: 200,
      Inventory: 100, TradeReceivables: 100, TradePayables: 50, PPE: 700, LIFO_reserve: 0,
      separationScore: 90, OA_PPE: 700, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 100, OA_DTA: 0, OA_CWIP: 0, OA_Other: 400,
    } as never,
    is: {
      Sales: 1000, TaxExpense: 30, taxRate: 0.25, PAT: 100,
      OCI: overrides.oci ?? 0, TCI: 100, TCI_NCI: 0, CNI: overrides.cni ?? 100,
      FinanceCost: 10, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 7, OI: 110, OtherItems: 0, OI_from_sales: 110, MII: 0, COGS: 600,
    } as never,
    cu: {
      UOI: 0, CoreOI: 110, UFE: 0, CoreNFE: 7, ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as never,
    cf: {
      CFO: overrides.cfo ?? 90, Capex: overrides.capex ?? -40,
      DividendPaid: -10, EquityIssued: overrides.issuance ?? 0, ShareBuybacks: overrides.buyback ?? 0,
      InterestReceived: 1, DividendReceived: 0,
      FCF_accounting: 50, FCF_cash: 50,
      d_t: 0, d_t_formula: 0, d_t_discrepancy: 0, EBITDA: 150,
    } as never,
    ratios: overrides.rnoa !== undefined ? { RNOA: overrides.rnoa } as never : undefined,
  };
}

function mkRaw(period_end: string): RawPeriodData {
  return { company_id: "TEST", period_end, raw_metric_values: {} };
}

describe("economicSanityGates / evaluateEconomicSanity", () => {
  it("blocks when no periods are provided", () => {
    const summary = evaluateEconomicSanity([], []);
    expect(summary.status).toBe("blocked");
    expect(summary.anchorPeriod).toBeNull();
  });

  it("passes when latest period is clean", () => {
    const periods = [
      mkRecastPeriod("2023-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2024-03-31", { rnoa: 0.11 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.12 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.status).toBe("passed");
    expect(summary.anchorPeriod).toBe("2025-03-31");
    expect(summary.skippedPeriods).toEqual([]);
  });

  it("Check A (terminal-period-contamination): blocks when latest-period buyback >= 5% CSE", () => {
    const periods = [
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    // Latest is contaminated; falls back to 2024-03-31
    expect(summary.anchorPeriod).toBe("2024-03-31");
    expect(summary.skippedPeriods.find((s) => s.period === "2025-03-31")).toBeTruthy();
  });

  it("Check A: passes when buyback is small (< 5% CSE)", () => {
    const periods = [
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.10, buyback: -10, cse: 1000 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.status).toBe("passed");
    expect(summary.anchorPeriod).toBe("2025-03-31");
  });

  it("Check C (RNOA jump): warns when RNOA jumps >= 30pp without a known cause", () => {
    const periods = [
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.45 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.status).toBe("warned");
    expect(summary.failedChecks.find((c) => c.checkId === "implausible-rnoa-jump")).toBeTruthy();
  });

  it("Check C: suppresses RNOA jump when an unusual item explains it", () => {
    const periods = [
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.45 }),
    ];
    const manifest: UnusualItemManifestLike[] = [
      { period: "2025-03-31", affectsTerminalEligibility: true, category: "asset-sale-gain-loss" },
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)), [], manifest);
    // Terminal eligibility now blocks via Check A (manifest contamination).
    // The RNOA jump check itself is suppressed.
    const rnoaCheck = summary.failedChecks.find((c) => c.checkId === "implausible-rnoa-jump");
    expect(rnoaCheck?.passed ?? true).toBe(true);
  });

  it("Check D (demerger): blocks when manifest flags demerger in latest period", () => {
    const periods = [
      mkRecastPeriod("2024-03-31"),
      mkRecastPeriod("2025-03-31"),
    ];
    const manifest: UnusualItemManifestLike[] = [
      { period: "2025-03-31", affectsTerminalEligibility: true, category: "demerger-scheme-effect" },
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)), [], manifest);
    expect(summary.anchorPeriod).toBe("2024-03-31");
    expect(summary.skippedPeriods.find((s) => s.period === "2025-03-31")).toBeTruthy();
  });

  it("Check E (anchor selection): walks back at most MAX_ANCHOR_LOOKBACK_PERIODS", () => {
    // All recent periods contaminated; only oldest is clean. With lookback=3,
    // we walk back at most 3 periods from latest.
    const periods = [
      mkRecastPeriod("2021-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2022-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
      mkRecastPeriod("2023-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
      mkRecastPeriod("2024-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.status).toBe("blocked");
    expect(summary.anchorPeriod).toBeNull();
    // Should have attempted MAX_ANCHOR_LOOKBACK_PERIODS + 1 periods.
    expect(summary.skippedPeriods.length).toBeGreaterThanOrEqual(MAX_ANCHOR_LOOKBACK_PERIODS);
  });

  it("Check E: returns first clean period when latest is contaminated", () => {
    const periods = [
      mkRecastPeriod("2023-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.anchorPeriod).toBe("2024-03-31");
    expect(summary.skippedPeriods).toHaveLength(1);
    expect(summary.skippedPeriods[0]!.period).toBe("2025-03-31");
  });

  it("RNOA_JUMP_THRESHOLD constant is exposed and reasonable", () => {
    expect(RNOA_JUMP_THRESHOLD).toBe(0.30);
  });

  it("emits anchorReason describing the walk-back path", () => {
    const periods = [
      mkRecastPeriod("2024-03-31", { rnoa: 0.10 }),
      mkRecastPeriod("2025-03-31", { rnoa: 0.10, buyback: -100, cse: 1000 }),
    ];
    const summary = evaluateEconomicSanity(periods, periods.map((p) => mkRaw(p.period_end)));
    expect(summary.anchorReason).toContain("Walked back");
    expect(summary.anchorReason).toContain("2024-03-31");
  });
});
