import { describe, it, expect } from "vitest";
import { computeEPV } from "../grahamDoddEPV";
import { RecastPeriod, EngineConfig, DEFAULT_CONFIG } from "../types";
import { PercentFraction, CroreShares, INRAbsolute } from "../types/units";

/** Minimal RecastPeriod factory for EPV testing. */
function makePeriod(overrides: {
  CoreOI: number;
  depreciation?: number;
  Capex?: number;
  NOA?: number;
  NFO?: number;
  OI?: number;
  Sales?: number;
}): RecastPeriod {
  const { CoreOI, depreciation = 100, Capex = -120, NOA = 5000, NFO = 1000, OI = CoreOI, Sales = 10000 } = overrides;
  return {
    period_end: "2024-03-31",
    bs: {
      CSE: NOA - NFO,
      NOA,
      OA: NOA * 0.8,
      OL: NOA * 0.2,
      FA: NFO > 0 ? 0 : Math.abs(NFO),
      FL: NFO > 0 ? NFO : 0,
      NFO,
      MI: 0,
      TA: NOA + (NFO > 0 ? 0 : Math.abs(NFO)),
      TL: NOA * 0.2 + (NFO > 0 ? NFO : 0),
    } as any,
    is: {
      Sales,
      OI,
      CNI: CoreOI * 0.75,
      NFE: NFO * 0.08,
      PAT: CoreOI * 0.75,
      TCI: CoreOI * 0.75,
      TCI_NCI: 0,
      TaxExpense: CoreOI * 0.25,
      taxRate: 0.252,
      FinanceCost: NFO > 0 ? NFO * 0.08 : 0,
      FinanceIncome: 0,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      OCI: 0,
      OtherItems: 0,
      OI_from_sales: OI,
      MII: 0,
      COGS: Sales * 0.5,
      operatingCostBridge: {
        materialCost: Sales * 0.4,
        employeeCost: Sales * 0.15,
        depreciation,
        sgaAdvertising: 0,
        sgaLegalProfessional: 0,
        sgaRent: 0,
        sgaFreight: 0,
        sgaRepairs: 0,
        sgaPowerFuel: 0,
        sgaDetailed: 0,
        sgaResidual: 0,
        sgaTotal: 0,
      },
    } as any,
    cu: {
      UOI: 0,
      CoreOI,
      UFE: 0,
      CoreNFE: NFO * 0.08,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: CoreOI * 0.8,
      Capex,
      CFF: 0,
      CFI: Capex,
      DividendsPaid: 0,
      NetBorrowings: 0,
    } as any,
  };
}

describe("Graham-Dodd EPV", () => {
  const baseConfig: EngineConfig = {
    ...DEFAULT_CONFIG,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.055,
    statutory_tax_rate: 0.252,
    shares_outstanding: CroreShares(100), // 100 Cr shares
    market_price: INRAbsolute(500),
  };

  it("returns null for fewer than 2 periods", () => {
    const result = computeEPV([makePeriod({ CoreOI: 1000 })], baseConfig);
    expect(result).toBeNull();
  });

  it("returns null for loss-maker (median CoreOI ≤ 0)", () => {
    const periods = [
      makePeriod({ CoreOI: -200 }),
      makePeriod({ CoreOI: -100 }),
      makePeriod({ CoreOI: 50 }),
    ];
    const result = computeEPV(periods, baseConfig);
    expect(result).toBeNull();
  });

  it("computes EPV for a stable industrial company", () => {
    const periods = [
      makePeriod({ CoreOI: 900, depreciation: 100, Capex: -120, NOA: 5000, NFO: 1000 }),
      makePeriod({ CoreOI: 1000, depreciation: 110, Capex: -130, NOA: 5200, NFO: 1100 }),
      makePeriod({ CoreOI: 1100, depreciation: 120, Capex: -140, NOA: 5400, NFO: 1200 }),
      makePeriod({ CoreOI: 1050, depreciation: 115, Capex: -135, NOA: 5300, NFO: 1150 }),
      makePeriod({ CoreOI: 950, depreciation: 105, Capex: -125, NOA: 5100, NFO: 1050 }),
    ];
    const result = computeEPV(periods, baseConfig);
    expect(result).not.toBeNull();

    // Median CoreOI = 1000 (sorted: 900, 950, 1000, 1050, 1100)
    expect(result!.normalizedCoreOI).toBe(1000);

    // Avg depreciation = (100+110+120+115+105)/5 = 110
    expect(result!.avgDepreciation).toBeCloseTo(110, 0);

    // Avg capex = (120+130+140+135+125)/5 = 130
    expect(result!.avgCapex).toBeCloseTo(130, 0);

    // Maintenance capex = min(130, 110) = 110
    expect(result!.maintenanceCapex).toBeCloseTo(110, 0);

    // Growth capex = 130 - 110 = 20
    expect(result!.growthCapex).toBeCloseTo(20, 0);

    // EBITDA = 1000 + 110 = 1110
    // Adjusted earnings = (1110 - 110) × (1 - 0.252) = 1000 × 0.748 = 748
    expect(result!.adjustedEarningsPower).toBeCloseTo(748, 0);

    // ke = DEFAULT_CONFIG.ke = 0.13 (takes precedence over rf+erp when > 0)
    expect(result!.ke).toBeCloseTo(0.13, 4);

    // kw = ke*0.80 + kd_aftertax*0.20 = 0.13*0.80 + (0.08*(1-0.2517))*0.20 ≈ 0.1160
    expect(result!.kw).toBeCloseTo(0.1160, 3);

    // EPV operations = 748 / kw ≈ 6450 (uses kw, not ke — enterprise value)
    expect(result!.epvOperations).toBeCloseTo(6450, 0);

    // EPV equity = 6450 - 1050 (latest NFO) ≈ 5400
    expect(result!.epvEquity).toBeCloseTo(5400, 0);

    // EPV per share = 5400 / 100 ≈ 54.0
    expect(result!.epvPerShare).toBeCloseTo(54.0, 0);

    // Reproduction value = latest NOA = 5100
    expect(result!.reproductionValue).toBe(5100);

    // Franchise value = 6450 - 5100 ≈ 1350 (positive → moat)
    expect(result!.franchiseValue).toBeCloseTo(1350, 0);
    expect(result!.moatSignal).toBe("moat");

    // Margin of safety = (54.0 - 500) / 500 ≈ -0.892 (overvalued vs EPV)
    expect(result!.marginOfSafety).toBeCloseTo(-0.892, 2);
  });

  it("identifies no-moat when EPV < reproduction value", () => {
    // Low CoreOI relative to NOA → no franchise value
    const periods = [
      makePeriod({ CoreOI: 200, depreciation: 300, Capex: -280, NOA: 8000, NFO: 2000 }),
      makePeriod({ CoreOI: 180, depreciation: 310, Capex: -290, NOA: 8100, NFO: 2100 }),
      makePeriod({ CoreOI: 220, depreciation: 320, Capex: -300, NOA: 8200, NFO: 2200 }),
    ];
    const result = computeEPV(periods, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.moatSignal).toBe("no-moat");
    expect(result!.franchiseValue).toBeLessThan(0);
  });

  it("handles company with capex < depreciation (under-investing)", () => {
    // Capex < depreciation → maintenance capex = capex (lower)
    const periods = [
      makePeriod({ CoreOI: 500, depreciation: 200, Capex: -80, NOA: 3000, NFO: 500 }),
      makePeriod({ CoreOI: 520, depreciation: 210, Capex: -90, NOA: 3100, NFO: 550 }),
      makePeriod({ CoreOI: 480, depreciation: 190, Capex: -70, NOA: 2900, NFO: 450 }),
    ];
    const result = computeEPV(periods, baseConfig);
    expect(result).not.toBeNull();

    // Avg capex = (80+90+70)/3 = 80
    // Avg depreciation = (200+210+190)/3 = 200
    // Maintenance = min(80, 200) = 80
    expect(result!.maintenanceCapex).toBeCloseTo(80, 0);
    expect(result!.avgDepreciation).toBeCloseTo(200, 0);

    // EBITDA = 500 + 200 = 700
    // Adjusted = (700 - 80) × 0.748 = 620 × 0.748 = 463.76
    expect(result!.adjustedEarningsPower).toBeCloseTo(463.76, 0);
  });

  it("returns null when ke is nonsensical", () => {
    const periods = [
      makePeriod({ CoreOI: 1000 }),
      makePeriod({ CoreOI: 1100 }),
    ];
    // ke = 0.005 < 0.01 threshold → null
    // Must also zero out cfg.ke so ke_from_config falls back to rf+erp
    const badConfig = { ...baseConfig, ke: PercentFraction(0), risk_free_rate: 0, equity_risk_premium: 0.005 };
    const result = computeEPV(periods, badConfig);
    expect(result).toBeNull();

    const veryBadConfig = { ...baseConfig, ke: PercentFraction(0), risk_free_rate: 0, equity_risk_premium: 0 };
    const result2 = computeEPV(periods, veryBadConfig);
    expect(result2).toBeNull();
  });

  it("produces explanation lines for audit trail", () => {
    const periods = [
      makePeriod({ CoreOI: 800, depreciation: 100, Capex: -150, NOA: 4000, NFO: 800 }),
      makePeriod({ CoreOI: 900, depreciation: 110, Capex: -160, NOA: 4200, NFO: 900 }),
      makePeriod({ CoreOI: 850, depreciation: 105, Capex: -155, NOA: 4100, NFO: 850 }),
    ];
    const result = computeEPV(periods, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.explanation.length).toBeGreaterThan(5);
    expect(result!.explanation[0]).toContain("Graham-Dodd EPV");
    expect(result!.explanation.some(l => l.includes("Maintenance capex"))).toBe(true);
    expect(result!.explanation.some(l => l.includes("Franchise value"))).toBe(true);
  });

  it("handles missing shares gracefully (epvPerShare = null)", () => {
    const periods = [
      makePeriod({ CoreOI: 1000 }),
      makePeriod({ CoreOI: 1100 }),
    ];
    const noSharesConfig = { ...baseConfig, shares_outstanding: undefined };
    const result = computeEPV(periods, noSharesConfig);
    expect(result).not.toBeNull();
    expect(result!.sharesOutstanding).toBeNull();
    expect(result!.epvPerShare).toBeNull();
    expect(result!.marginOfSafety).toBeNull();
  });

  it("IT-services company with high CoreOI and low capex shows strong moat", () => {
    // TCS-like: high margins, low capex, moderate NOA
    const periods = [
      makePeriod({ CoreOI: 4000, depreciation: 200, Capex: -250, NOA: 8000, NFO: -2000 }),
      makePeriod({ CoreOI: 4200, depreciation: 210, Capex: -260, NOA: 8500, NFO: -2200 }),
      makePeriod({ CoreOI: 4400, depreciation: 220, Capex: -270, NOA: 9000, NFO: -2500 }),
      makePeriod({ CoreOI: 4100, depreciation: 205, Capex: -255, NOA: 8200, NFO: -2100 }),
    ];
    const result = computeEPV(periods, { ...baseConfig, shares_outstanding: CroreShares(366) });
    expect(result).not.toBeNull();
    expect(result!.moatSignal).toBe("moat");
    // Negative NFO means cash-rich → EPV equity > EPV operations
    expect(result!.epvEquity).toBeGreaterThan(result!.epvOperations);
    expect(result!.franchiseValue).toBeGreaterThan(0);
  });

  // F2: EPV golden test for ke-vs-kw bug.
  // For a levered company (FLEV > 0, NFO > 0), EPV_operations discounted at
  // kw (WACC) must be HIGHER than if discounted at ke, because kw < ke.
  // This test would have caught the original bug where epvOperations used ke.
  it("F2: levered company EPV_operations is higher when discounted at kw vs ke", () => {
    const periods = [
      makePeriod({ CoreOI: 1000, depreciation: 100, Capex: -120, NOA: 5000, NFO: 2000 }),
      makePeriod({ CoreOI: 1050, depreciation: 105, Capex: -125, NOA: 5200, NFO: 2100 }),
      makePeriod({ CoreOI: 950, depreciation: 95, Capex: -115, NOA: 4800, NFO: 1900 }),
    ];
    // baseConfig has ke=0.13, kd_pretax=0.08, tax_rate_for_kd=0.2517
    // kw = 0.13*0.80 + (0.08*(1-0.2517))*0.20 ≈ 0.1160 < ke=0.13
    const result = computeEPV(periods, baseConfig);
    expect(result).not.toBeNull();

    // kw < ke → EPV_operations(kw) > EPV_operations(ke)
    // Verify kw is actually less than ke
    expect(result!.kw).toBeLessThan(result!.ke);

    // EPV_operations = adjustedEarningsPower / kw
    // If we had used ke instead: adjustedEarningsPower / ke < adjustedEarningsPower / kw
    const hypotheticalEPVWithKe = result!.adjustedEarningsPower / result!.ke;
    expect(result!.epvOperations).toBeGreaterThan(hypotheticalEPVWithKe);

    // The difference should be material (not just floating point noise)
    const pctDiff = (result!.epvOperations - hypotheticalEPVWithKe) / hypotheticalEPVWithKe;
    expect(pctDiff).toBeGreaterThan(0.05); // at least 5% higher when using kw
  });
});
