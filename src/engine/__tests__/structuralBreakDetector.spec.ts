import { describe, it, expect } from "vitest";
import { detectStructuralBreaks } from "../structuralBreakDetector";
import type { RecastPeriod } from "../types";

function mkPeriod(period_end: string, cse: number, sales: number, noa: number): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: noa + 200, CSE: cse, MI: 0, FA: 100, FO: 50, OA: noa + 100, OL: 400,
      NOA: noa, NFO: 100, DTL: 50, PensionObl: 0, OL_ex_DTL: 350,
      Goodwill: 0, CurrentAssets: 500, CurrentLiabilities: 300, BridgeDebtTotal: 100,
      Inventory: 100, TradeReceivables: 150, TradePayables: 100,
      PPE: 300, LIFO_reserve: 0, separationScore: 0.8,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 100,
      OL_ProvisionsCurrent: 50, OL_ProvisionsLongTerm: 50,
      OL_CurrentTaxLiabilities: 50, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 50, OL_OtherNonCurrentLiabilities: 0,
      OA_PPE: 300, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 150, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: noa - 700,
    } as RecastPeriod["bs"],
    is: {
      Sales: sales, TaxExpense: 25, taxRate: 0.25, PAT: 75, OCI: 0, TCI: 75, TCI_NCI: 0,
      FinanceCost: 20, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 20, OI: 100, OtherItems: 0, CNI: 100, OI_from_sales: 100, MII: 0, COGS: 400,
    } as RecastPeriod["is"],
    cu: {
      UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 20,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as RecastPeriod["cu"],
    cf: {
      CFO: 100, Capex: 30, DividendPaid: 30, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 70, FCF_cash: 70,
      d_t: 30, d_t_formula: 30, d_t_discrepancy: 0, EBITDA: 130,
    } as RecastPeriod["cf"],
    ratios: {} as RecastPeriod["ratios"],
  } as RecastPeriod;
}

describe("detectStructuralBreaks — Phase I robustness", () => {
  it("returns no breaks for stable series", () => {
    const periods = Array.from({ length: 5 }, (_, i) =>
      mkPeriod(`${2020 + i}-03-31`, 1000 + i * 50, 800 + i * 40, 1500 + i * 100),
    );
    const result = detectStructuralBreaks(periods);
    expect(result.hasBreaks).toBe(false);
    expect(result.breaks).toEqual([]);
    expect(result.recommendation).toMatch(/No structural breaks/);
  });

  it("returns insufficient-data note for empty/single-period input", () => {
    expect(detectStructuralBreaks(null).recommendation).toMatch(/≥2 periods/);
    expect(detectStructuralBreaks([]).recommendation).toMatch(/≥2 periods/);
    expect(
      detectStructuralBreaks([mkPeriod("2025-03-31", 1000, 800, 1500)])
        .recommendation,
    ).toMatch(/≥2 periods/);
  });

  it("flags equity drop > 30% (Reliance/Jio Financial scenario)", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 1100, 850, 1600),
      mkPeriod("2024-03-31", 600, 880, 1700), // ~45% equity drop = demerger
      mkPeriod("2025-03-31", 700, 920, 1800),
    ];
    const result = detectStructuralBreaks(periods);
    expect(result.hasBreaks).toBe(true);
    const equityBreaks = result.breaks.filter((b) => b.kind === "equity-drop");
    expect(equityBreaks.length).toBe(1);
    expect(equityBreaks[0]!.period_end).toBe("2024-03-31");
    expect(equityBreaks[0]!.reason).toMatch(/demerger|capital reduction/);
    expect(result.affectedPeriods.has("2023-03-31")).toBe(true);
    expect(result.affectedPeriods.has("2024-03-31")).toBe(true);
  });

  it("flags equity jump > 50% (IPO/QIP scenario)", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 1700, 850, 1600), // 70% jump = capital raise
      mkPeriod("2024-03-31", 1750, 880, 1700),
    ];
    const result = detectStructuralBreaks(periods);
    const jumps = result.breaks.filter((b) => b.kind === "equity-jump");
    expect(jumps.length).toBe(1);
    expect(jumps[0]!.reason).toMatch(/capital raise|IPO|QIP/);
  });

  it("flags revenue drop (segment divestiture)", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 1050, 500, 1500), // 37% revenue drop
      mkPeriod("2024-03-31", 1100, 520, 1500),
    ];
    const result = detectStructuralBreaks(periods);
    const drops = result.breaks.filter((b) => b.kind === "revenue-drop");
    expect(drops.length).toBe(1);
    expect(drops[0]!.reason).toMatch(/divestiture|demerger|demand shock/);
  });

  it("flags NOA jump (M&A acquisition)", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 1100, 850, 2500), // 67% NOA jump = acquisition
      mkPeriod("2024-03-31", 1150, 900, 2600),
    ];
    const result = detectStructuralBreaks(periods);
    const jumps = result.breaks.filter((b) => b.kind === "asset-base-jump");
    expect(jumps.length).toBe(1);
    expect(jumps[0]!.reason).toMatch(/M&A|acquisition|IFRS-16/);
  });

  it("flags multiple breaks in one transition (demerger affects equity AND revenue AND NOA)", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 1050, 850, 1600),
      mkPeriod("2024-03-31", 600, 500, 900), // full demerger: -43% equity, -41% rev, -44% NOA
      mkPeriod("2025-03-31", 650, 530, 950),
    ];
    const result = detectStructuralBreaks(periods);
    expect(result.breaks.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(result.breaks.map((b) => b.kind));
    expect(kinds.has("equity-drop")).toBe(true);
    expect(kinds.has("revenue-drop")).toBe(true);
    expect(kinds.has("asset-base-drop")).toBe(true);
  });

  it("ignores small fluctuations within thresholds", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 850, 700, 1300), // -15% equity, -12% rev, -13% NOA — all under threshold
      mkPeriod("2024-03-31", 880, 720, 1320),
    ];
    const result = detectStructuralBreaks(periods);
    expect(result.hasBreaks).toBe(false);
  });

  it("respects custom thresholds", () => {
    const periods = [
      mkPeriod("2022-03-31", 1000, 800, 1500),
      mkPeriod("2023-03-31", 850, 800, 1500), // -15% equity drop
      mkPeriod("2024-03-31", 880, 850, 1550),
    ];
    // Default threshold is -30%, so -15% wouldn't flag.
    expect(detectStructuralBreaks(periods).hasBreaks).toBe(false);
    // Custom threshold of -10% catches it.
    const tighter = detectStructuralBreaks(periods, { equityDrop: -0.10 });
    expect(tighter.breaks.filter((b) => b.kind === "equity-drop").length).toBe(1);
  });
});
