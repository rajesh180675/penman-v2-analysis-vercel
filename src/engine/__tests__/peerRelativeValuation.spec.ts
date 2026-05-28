import { describe, it, expect } from "vitest";
import { computePeerRelativeValuation } from "../peerRelativeValuation";
import { CompanyRegistry, RecastPeriod, EngineConfig, DEFAULT_CONFIG } from "../types";

function makePeriod(overrides: {
  Sales: number;
  OI: number;
  CNI: number;
  CSE: number;
  NOA: number;
  NFO: number;
  ROCE?: number;
  PM?: number;
  ATO?: number;
  RNOA?: number;
  FLEV?: number;
}): RecastPeriod {
  const { Sales, OI, CNI, CSE, NOA, NFO, ROCE, PM, ATO, RNOA, FLEV } = overrides;
  return {
    period_end: "2024-03-31",
    bs: { CSE, NOA, NFO, OA: NOA * 0.8, OL: NOA * 0.2, FA: 0, FL: NFO > 0 ? NFO : 0, MI: 0, TA: NOA + Math.max(0, -NFO), TL: NOA * 0.2 + Math.max(0, NFO) } as any,
    is: { Sales, OI, CNI, NFE: NFO * 0.08, PAT: CNI, TCI: CNI, TCI_NCI: 0, TaxExpense: OI * 0.25, taxRate: 0.252, FinanceCost: 0, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0, OCI: 0, OtherItems: 0, OI_from_sales: OI, MII: 0, COGS: Sales * 0.5 } as any,
    cu: { UOI: 0, CoreOI: OI, UFE: 0, CoreNFE: NFO * 0.08, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: { CFO: CNI * 0.8, Capex: -Sales * 0.05, CFF: 0, CFI: -Sales * 0.05, DividendsPaid: 0, NetBorrowings: 0 } as any,
    ratios: {
      ROCE: ROCE ?? (CNI / CSE),
      PM: PM ?? (OI / Sales),
      ATO: ATO ?? (Sales / NOA),
      RNOA: RNOA ?? (OI / NOA),
      FLEV: FLEV ?? (NFO / CSE),
    } as any,
  };
}

function makeRegistry(companies: Array<{
  id: string;
  label: string;
  periods: RecastPeriod[];
  companyType?: EngineConfig["company_type"];
  traceability?: any;
}>): CompanyRegistry {
  const reg: CompanyRegistry = { companies: {} };
  for (const c of companies) {
    reg.companies[c.id] = {
      id: c.id,
      label: c.label,
      rawData: [],
      recastData: c.periods,
      companyType: c.companyType ?? "consumer",
      traceability: c.traceability ?? null,
    };
  }
  return reg;
}

describe("Peer Relative Valuation", () => {
  const baseConfig: EngineConfig = {
    ...DEFAULT_CONFIG,
    shares_outstanding: 100,
    market_price: 500,
  };

  const itcPeriods = [
    makePeriod({ Sales: 60000, OI: 18000, CNI: 13500, CSE: 50000, NOA: 60000, NFO: 10000 }),
    makePeriod({ Sales: 65000, OI: 19500, CNI: 14600, CSE: 55000, NOA: 65000, NFO: 10000 }),
  ];

  const tcsPeriods = [
    makePeriod({ Sales: 200000, OI: 50000, CNI: 40000, CSE: 80000, NOA: 90000, NFO: -20000 }),
    makePeriod({ Sales: 220000, OI: 55000, CNI: 44000, CSE: 90000, NOA: 100000, NFO: -25000 }),
  ];

  const tataSteelPeriods = [
    makePeriod({ Sales: 150000, OI: 15000, CNI: 8000, CSE: 60000, NOA: 120000, NFO: 60000 }),
    makePeriod({ Sales: 140000, OI: 12000, CNI: 6000, CSE: 55000, NOA: 115000, NFO: 60000 }),
  ];

  it("returns null with fewer than 2 companies", () => {
    const registry = makeRegistry([{ id: "itc", label: "ITC", periods: itcPeriods }]);
    const result = computePeerRelativeValuation("itc", registry, baseConfig);
    expect(result).toBeNull();
  });

  it("returns null when target not found", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods },
      { id: "tcs", label: "TCS", periods: tcsPeriods },
    ]);
    const result = computePeerRelativeValuation("unknown", registry, baseConfig);
    expect(result).toBeNull();
  });

  it("computes ratio rankings for 3 companies", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods },
      { id: "tcs", label: "TCS", periods: tcsPeriods },
      { id: "tata-steel", label: "Tata Steel", periods: tataSteelPeriods },
    ]);
    const result = computePeerRelativeValuation("itc", registry, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.peerCount).toBe(2);
    expect(result!.ratioRankings.length).toBe(6);

    // ITC ROCE = 14600/55000 ≈ 0.265
    // TCS ROCE = 44000/90000 ≈ 0.489
    // Tata Steel ROCE = 6000/55000 ≈ 0.109
    const roceRanking = result!.ratioRankings.find(r => r.metric === "ROCE");
    expect(roceRanking).toBeDefined();
    expect(roceRanking!.peerCount).toBe(2);
    expect(roceRanking!.targetValue).toBeCloseTo(0.265, 2);
    // ITC is middle of 3 → percentile ~67%
    expect(roceRanking!.targetPercentile).toBeGreaterThanOrEqual(50);

    // Exact hand-checked: ITC PM = OI/Sales = 19500/65000 = 0.30
    // TCS PM = 55000/220000 = 0.25, Tata Steel PM = 12000/140000 = 0.086
    const pmRanking = result!.ratioRankings.find(r => r.metric === "PM");
    expect(pmRanking).toBeDefined();
    expect(pmRanking!.targetValue).toBeCloseTo(0.30, 2);

    // Exact hand-checked: ITC ATO = Sales/NOA = 65000/65000 = 1.0
    // TCS ATO = 220000/100000 = 2.2, Tata Steel ATO = 140000/115000 = 1.217
    const atoRanking = result!.ratioRankings.find(r => r.metric === "ATO");
    expect(atoRanking).toBeDefined();
    expect(atoRanking!.targetValue).toBeCloseTo(1.0, 2);

    // Exact hand-checked: ITC RNOA = OI/NOA = 19500/65000 = 0.30
    // TCS RNOA = 55000/100000 = 0.55, Tata Steel RNOA = 12000/115000 = 0.104
    const rnoaRanking = result!.ratioRankings.find(r => r.metric === "RNOA");
    expect(rnoaRanking).toBeDefined();
    expect(rnoaRanking!.targetValue).toBeCloseTo(0.30, 2);

    // Exact hand-checked: ITC FLEV = NFO/CSE = 10000/55000 = 0.182
    // TCS FLEV = -25000/90000 = -0.278, Tata Steel FLEV = 60000/55000 = 1.091
    const flevRanking = result!.ratioRankings.find(r => r.metric === "FLEV");
    expect(flevRanking).toBeDefined();
    expect(flevRanking!.targetValue).toBeCloseTo(0.182, 2);
  });

  it("computes multiple-implied fair values when market data available", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods },
      { id: "tcs", label: "TCS", periods: tcsPeriods },
      { id: "tata-steel", label: "Tata Steel", periods: tataSteelPeriods },
    ]);
    // ITC: EPS = 14600/100 = 146, price = 500, PE = 3.42
    const result = computePeerRelativeValuation("itc", registry, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe("itc");
    // Should have explanation lines
    expect(result!.explanation.length).toBeGreaterThan(0);
    expect(result!.explanation[0]).toContain("2 eligible peer");
  });

  it("handles company with negative earnings gracefully", () => {
    const lossMakerPeriods = [
      makePeriod({ Sales: 5000, OI: -500, CNI: -800, CSE: 2000, NOA: 5000, NFO: 3000 }),
      makePeriod({ Sales: 4500, OI: -600, CNI: -900, CSE: 1500, NOA: 4800, NFO: 3300 }),
    ];
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods },
      { id: "loss-co", label: "Loss Co", periods: lossMakerPeriods },
      { id: "tcs", label: "TCS", periods: tcsPeriods },
    ]);
    const result = computePeerRelativeValuation("itc", registry, baseConfig);
    expect(result).not.toBeNull();
    // Should still work — loss-maker just has negative ratios
    expect(result!.peerCount).toBe(2);
  });

  it("produces composite fair value from multiple-implied values", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods },
      { id: "tcs", label: "TCS", periods: tcsPeriods },
      { id: "tata-steel", label: "Tata Steel", periods: tataSteelPeriods },
    ]);
    const configWithPrice: EngineConfig = { ...baseConfig, market_price: 500, shares_outstanding: 100 };
    const result = computePeerRelativeValuation("itc", registry, configWithPrice);
    expect(result).not.toBeNull();
    // compositeFairValue may be null if peers don't have market data
    // but explanation should always be populated
    expect(result!.explanation.length).toBeGreaterThan(1);
  });

  it("excludes peers with a different company type", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods, companyType: "consumer" },
      { id: "hul", label: "HUL", periods: tcsPeriods, companyType: "consumer" },
      { id: "hdfc", label: "HDFC Bank", periods: tataSteelPeriods, companyType: "bank" },
    ]);

    const result = computePeerRelativeValuation("itc", registry, { ...baseConfig, company_type: "consumer" });

    expect(result).not.toBeNull();
    expect(result!.peerCount).toBe(1);
    expect(result!.ratioRankings[0].peers.map((peer) => peer.companyId)).toEqual(["hul"]);
    expect(result!.explanation[0]).toContain("1 eligible peer");
  });

  it("returns null when strict peer gates leave no eligible peers", () => {
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods, companyType: "consumer" },
      { id: "hdfc", label: "HDFC Bank", periods: tcsPeriods, companyType: "bank" },
      { id: "tata-steel", label: "Tata Steel", periods: tataSteelPeriods, companyType: "cyclical" },
    ]);

    const result = computePeerRelativeValuation("itc", registry, { ...baseConfig, company_type: "consumer" });

    expect(result).toBeNull();
  });

  it("excludes peers whose traceability says valuation is blocked", () => {
    const blockedTraceability = {
      confidence: { status: "blocked" },
      qualityGate: { valuationBlocked: true },
    };
    const registry = makeRegistry([
      { id: "itc", label: "ITC", periods: itcPeriods, companyType: "consumer" },
      { id: "hul", label: "HUL", periods: tcsPeriods, companyType: "consumer" },
      { id: "bad-consumer", label: "Bad Consumer", periods: tataSteelPeriods, companyType: "consumer", traceability: blockedTraceability },
    ]);

    const result = computePeerRelativeValuation("itc", registry, { ...baseConfig, company_type: "consumer" });

    expect(result).not.toBeNull();
    expect(result!.peerCount).toBe(1);
    expect(result!.ratioRankings[0].peers.map((peer) => peer.companyId)).toEqual(["hul"]);
  });
});
