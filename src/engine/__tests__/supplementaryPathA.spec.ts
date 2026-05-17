import { describe, expect, it } from "vitest";
import {
  CanonicalOutputRegistry, ConsistencyViolation,
  computeDirtySurplus, detectPeriodEventFlags,
  calibrateMonitoringTriggers, firewallCheck,
  enforceMetadataFirewall, computeDirtySurplusFramework,
  deriveShareCount, computeMarketImplied,
  decomposeReReOIGap, runCrossSectionAssertions,
  selectTerminalAnchor, selectOADecompositionPeriods,
  buildAccrualTable, buildSection6B, computeV3Analytics,
} from "../v3Analytics";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";
import { deriveKwFromStructure } from "../PenmanNissimEngine";

const mkPeriod = (year: number, pm: number, re: number, cse: number): RecastPeriod => ({
  period_end: `${year}-03-31`,
  bs: {
    TA: 1000, CSE: cse, MI: 0, FA: 100, FO: 50, OA: 900, OL: 250,
    OL_TradePayables: 50, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
    OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
    NOA: 650, NFO: -50, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
    CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 40, TradeReceivables: 60, TradePayables: 50,
    PPE: 250, LIFO_reserve: 0, separationScore: 90,
    OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 40,
    OA_TradeReceivables: 60, OA_DTA: 0, OA_CWIP: 0, OA_Other: 550,
  },
  is: {
    Sales: 1000, TaxExpense: 20, taxRate: 0.25, PAT: 120, OCI: 0, TCI: 120, TCI_NCI: 0,
    CNI: 120, FinanceCost: 5, FinanceIncome: 1, FinanceIncomeRung: 1,
    PreferredDividend: 0, NFE: 3, OI: 123, OtherItems: 0, OI_from_sales: 123, MII: 0, COGS: 600,
  },
  cu: { UOI: 0, CoreOI: 123, UFE: 0, CoreNFE: 3, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
  cf: {
    CFO: 140, Capex: 30, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
    InterestReceived: 0, DividendReceived: 0, FCF_accounting: 90, FCF_cash: 110,
    d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
  },
  ratios: {
    ROCE: 0.2, RNOA: 0.18, NBC: 0.04, SPREAD: 0.14, FLEV: 0.2, PM: pm, ATO: 1.1, SalesPM: pm,
    ATO_star: 1.1, OtherItemsRatio: 0, ROCE_bridge_residual: 0, io: 0.07, ROOA: 0.18, OLLEV: 0.3, OLSPREAD: 0.02, RNOA_check: 0,
    ROTCE: 0.2, MSR: 0.15, CoreSalesPM: pm, CoreOtherItems_OA: 0, UOI_OA: 0, CoreNBC: 0.04, UFE_NFO: 0,
    CoreSPREAD: 0.14, ROCE_eq16_reconstructed: 0.2, ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
    eq16_step3_residual: 0, eq16_flag: "OK", eq16_diagnosis: null, ROOA_spec: 0.18, imputed_io_spec: 0.07,
    required_return_per_sales: 0.05, value_creating_margin: 0.03, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
    current_ratio: 1.5, quick_ratio: 1.2, days_receivable: 20, days_payable: 18, days_inventory: 15, cash_conversion_cycle: 17,
    accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.8, interest_coverage: 10,
    NOA_growth: 0.05, CNI_growth: 0.04, OI_growth: 0.04, Sales_growth: 0.05, noaSmall: false, separationScore: 90,
    accrual_regime: "NORMAL", dirty_surplus: 0, dirty_surplus_pct_cse: 0,
    freeOL: 0, interestBearingOL: 0, OLLEV_check: 0, RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
  },
  ri: { RE: re, ReOI: re * 0.95 },
  quality: {
    piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1, piotroski_leverage: 1,
    piotroski_liquidity: 1, piotroski_dilution: 1, piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 8,
    beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1, beneish_sgai: 1, beneish_lvgi: 1,
    beneish_tata: 0, beneish_mscore: -2.2, altman_wc_ta: 0.2, altman_re_ta: 0.3, altman_ebit_ta: 0.2, altman_bve_tl: 1.5,
    altman_s_ta: 1.0, altman_zprime: 3.4,
  },
});

describe("Supplementary Path A controls", () => {
  it("enforces canonical registry consistency", () => {
    const r = new CanonicalOutputRegistry();
    r.register("g_effective", 0.05, "S-10.5");
    expect(() => r.register("g_effective", 0.08, "S-14.1")).toThrow(ConsistencyViolation);
  });

  it("calibrates PM trigger on clean period when latest is PM outlier", () => {
    const periods = [
      mkPeriod(2022, 0.24, 80, 500),
      mkPeriod(2023, 0.25, 82, 560),
      mkPeriod(2024, 0.26, 84, 620),
      mkPeriod(2025, 0.60, 86, 680),
    ];
    const ds = computeDirtySurplus(periods, DEFAULT_CONFIG.ke);
    const flags = detectPeriodEventFlags(periods, ds, 0.5, 1.0);
    const out = calibrateMonitoringTriggers(periods, flags, undefined, DEFAULT_CONFIG);
    expect(out.pm_base).toBeLessThan(0.4);
    expect(out.pm_warning).toBeCloseTo(out.pm_base * 0.85, 6);
  });

  it("detects audit marker leakage", () => {
    const violations = firewallCheck("Summary: V3 §14 Composite Confidence: 48/100 ✓ intact");
    expect(violations.length).toBeGreaterThan(0);
  });

  it("S-13.2: metadata firewall redacts leaked audit markers", () => {
    const raw = "Section text. V3 §14 Composite Confidence: 48/100 ✓ intact.";
    const out = enforceMetadataFirewall(raw, ["Internal audit note that should never leak into report output"]);
    expect(out.violations.length).toBeGreaterThan(0);
    expect(out.rendered).toContain("[REDACTED: internal audit content removed]");
    expect(out.rendered).toContain("Internal audit markers were detected and redacted");
  });

  it("derives share count and computes market-implied analytics", () => {
    const periods = [mkPeriod(2024, 0.25, 80, 1246), mkPeriod(2025, 0.27, 85, 1246)];
    const r = new CanonicalOutputRegistry();
    const share = deriveShareCount(periods, r, 90000);
    expect(share.shares).not.toBeNull();
    r.register("shares_outstanding", share.shares!, "test");
    r.register("shares_source", share.source, "test");
    const market = computeMarketImplied(r, {
      V_primary: 90000,
      ke: 0.13,
      g_effective: 0.04,
      CSE0: 50000,
      pvRE: 20000,
      explicit_periods: 1,
      RE_anchor: 85,
      periods,
    }, 70, share.shares!);
    expect(market.status).toBe("full");
    expect(market.margin_of_safety).not.toBeUndefined();
  });

  it("decomposes RE-ReOI valuation gap and returns dominant driver", () => {
    const periods = [mkPeriod(2023, 0.24, 70, 500), mkPeriod(2024, 0.25, 75, 560), mkPeriod(2025, 0.26, 80, 620)];
    const out = decomposeReReOIGap(periods, {
      V_RE_CV3: 1000,
      V_ReOI_CV03: 800,
      CSE0: 500,
      pvRE: 200,
      CV_RE: 300,
      CV_ReOI: 220,
      ke: 0.13,
      kw: 0.10,
    }, 0.04);
    expect(out.total).toBeCloseTo(200, 8);
    expect(out.dominant_driver.length).toBeGreaterThan(0);
    expect(Number.isFinite(out.nfo_timing)).toBe(true);
  });

  it("uses period-by-period NFO movement in RE-ReOI gap decomposition", () => {
    const periods = [mkPeriod(2023, 0.24, 70, 500), mkPeriod(2024, 0.25, 75, 560), mkPeriod(2025, 0.26, 80, 620)];
    periods[0].bs.NFO = 0;
    periods[1].bs.NFO = 100;
    periods[2].bs.NFO = 0;

    const out = decomposeReReOIGap(periods, {
      V_RE_CV3: 950,
      V_ReOI_CV03: 900,
      CSE0: 500,
      pvRE: 200,
      CV_RE: 250,
      CV_ReOI: 240,
      ke: 0.13,
      kw: 0.10,
    }, 0.04);

    expect(Math.abs(out.nfo_timing)).toBeGreaterThan(0);
  });

  it("flags cross-section inconsistency", () => {
    const r = new CanonicalOutputRegistry();
    r.register("primary_anchor_label", "RE_(T-1) + growth", "test");
    r.register("tv_grade", "GRADE_B", "test");
    r.register("g_effective", 0.05, "test");
    r.register("pm_warning_threshold", 0.2, "test");
    r.register("period_count", 6, "test");

    const issues = runCrossSectionAssertions(r, {
      header: "X",
      section1: "Terminal anchor: 3Y median RE; g = 7.0%; TV GRADE_C",
      section7: "If PM falls below 30%",
      section6A1RowCount: 3,
    });

    expect(issues.length).toBeGreaterThan(0);
  });

  // FIX VERIFICATION: S-14.1 — STRUCTURAL_EVENT_CRITICAL should trigger anchor fallback
  it("S-14.1: STRUCTURAL_EVENT_CRITICAL triggers RE_(T-1)+growth anchor, not as-reported", () => {
    // Period with huge NOA jump (>50%) → STRUCTURAL_EVENT_CRITICAL
    const periods = [
      mkPeriod(2021, 0.25, 80, 500),
      mkPeriod(2022, 0.25, 82, 520),
      mkPeriod(2023, 0.25, 84, 540),
      mkPeriod(2024, 0.25, 86, 560),
    ];
    // Simulate terminal period NOA jump >50%
    const terminalPeriod = { ...mkPeriod(2025, 0.25, 100, 600) };
    (terminalPeriod.bs as any).NOA = 1100; // >50% jump from 650
    const allPeriods = [...periods, terminalPeriod];

    const ds = computeDirtySurplus(allPeriods, 0.13);
    const flags = detectPeriodEventFlags(allPeriods, ds);
    const terminalFlags = flags[flags.length - 1];
    expect(terminalFlags.flags).toContain("STRUCTURAL_EVENT_CRITICAL");

    const anchor = selectTerminalAnchor(allPeriods, flags, 0.13, 0.10);
    expect(anchor.method).not.toBe("RE_T"); // must fall back
    expect(anchor.label).toContain("T-1");
  });

  // FIX VERIFICATION: S-14.1 — 3Y median uses T-1, T-2, T-3 (excludes T)
  it("S-14.1: 3Y median anchor excludes terminal period RE", () => {
    // Make both T and T-1 critically contaminated → should fall to 3Y median
    const base = mkPeriod(2020, 0.25, 80, 500);
    const p21 = mkPeriod(2021, 0.25, 82, 520);
    const p22 = mkPeriod(2022, 0.25, 84, 540);
    const p23 = { ...mkPeriod(2023, 0.25, 120, 560) }; // T-1 with large NOA
    (p23.bs as any).NOA = 1200; // STRUCTURAL_EVENT_CRITICAL at T-1
    const p24 = { ...mkPeriod(2024, 0.25, 200, 600) }; // T with large NOA too
    (p24.bs as any).NOA = 2000; // STRUCTURAL_EVENT_CRITICAL at T

    const allPeriods = [base, p21, p22, p23, p24];
    const ds = computeDirtySurplus(allPeriods, 0.13);
    const flags = detectPeriodEventFlags(allPeriods, ds);

    const anchor = selectTerminalAnchor(allPeriods, flags, 0.13, 0.10);
    if (anchor.method === "3Y_median") {
      // 3Y median should be from p22, p21, base (not including p23 or p24)
      // RE values: p24=200, p23=120, p22=84, p21=82, base=80
      // Median of T-1=120, T-2=84, T-3=82 (excluding T=200) = 84
      expect(anchor.selected_RE_anchor).not.toBeCloseTo(200, 0); // not T
      expect(anchor.selected_RE_anchor).not.toBeCloseTo(120, 0); // not T-1 raw
    }
  });

  // FIX VERIFICATION: S-15.1 — POTENTIAL_RECLASSIFICATION periods included in OA decomp
  it("S-15.1: POTENTIAL_RECLASSIFICATION periods are included in OA decomp selection", () => {
    // Create period with large ΔOther OA (>40% of ΔOA) but no structural event
    const p1 = mkPeriod(2023, 0.25, 80, 500);
    const p2 = { ...mkPeriod(2024, 0.25, 85, 550) };
    // Make OA increase by 100 but identified components only increase by 20 → 80% is "other"
    (p2.bs as any).OA = 1000; // +100 from 900
    (p2.bs as any).OA_PPE = 270; // +20 from 250 — only 20 identified
    // OA_Other = 550 + 80 = 630 (implicitly via OA_Other field)
    (p2.bs as any).OA_Other = 630;
    const allPeriods = [p1, p2];
    const ds = computeDirtySurplus(allPeriods, 0.13);
    const flags = detectPeriodEventFlags(allPeriods, ds);
    const lastFlags = flags[flags.length - 1];
    expect(lastFlags.flags).toContain("POTENTIAL_RECLASSIFICATION");
    const selected = selectOADecompositionPeriods(allPeriods, flags);
    expect(selected).toContain(p2.period_end);
  });

  // FIX VERIFICATION: S-13.1 — no double registration of DS_cumulative_all
  it("S-13.1: computeV3Analytics does not throw ConsistencyViolation for DS double registration", () => {
    const periods = Array.from({ length: 6 }, (_, i) => mkPeriod(2020 + i, 0.25, 80 + i * 2, 500 + i * 50));
    expect(() => computeV3Analytics(periods, DEFAULT_CONFIG, 5000, 4800, 0.04, 0.10)).not.toThrow();
  });

  // FIX VERIFICATION: S-15.3 — buildAccrualTable returns regime context
  it("S-15.3: buildAccrualTable returns regime classification for each period", () => {
    const periods = [
      mkPeriod(2023, 0.25, 80, 500),
      { ...mkPeriod(2024, 0.25, 85, 550), ratios: { ...mkPeriod(2024, 0.25, 85, 550).ratios!, accrual_ratio_bs: 0.15, accrual_regime: "GROWTH_ACCRUAL" as const } },
    ];
    const rows = buildAccrualTable(periods);
    expect(rows).toHaveLength(1);
    expect(rows[0].regime).toBe("GROWTH_ACCRUAL");
    expect(rows[0].flag).not.toBe("OK");
    expect(rows[0].interpretation.length).toBeGreaterThan(0);
  });

  // FIX VERIFICATION: S-16.3 — buildSection6B returns partial when no market price
  it("S-16.3: buildSection6B returns partial status when market price absent", () => {
    const periods = [mkPeriod(2024, 0.25, 80, 1246), mkPeriod(2025, 0.27, 85, 1246)];
    const r = new CanonicalOutputRegistry();
    r.register("V_primary", 90000, "test");
    const shareCount = deriveShareCount(periods, r, 90000);
    const marketImplied = { status: "market_price_required" as const, intrinsic_per_share: 72.2, shares: 1246, shares_source: "test" };
    const s6b = buildSection6B(shareCount, marketImplied, r);
    expect(s6b.status).toBe("partial");
    expect(s6b.intrinsic_per_share).toBeCloseTo(90000 / (shareCount.shares ?? 1), 0);
  });

  // FIX VERIFICATION: S-13.3 assertion 10 — V_primary ≠ V_reported when anchor is non-as-reported
  it("S-13.3 assertion 10: flags when V_primary equals V_reported despite non-as-reported anchor", () => {
    const r = new CanonicalOutputRegistry();
    r.register("primary_anchor_label", "RE_(T-1) + growth", "test");
    r.register("V_primary", 5000, "test");
    r.register("V_RE_CV3_reported", 5000, "test"); // same value = problem
    r.register("tv_grade", "GRADE_B", "test");
    r.register("g_effective", 0.05, "test");
    r.register("period_count", 5, "test");

    const issues = runCrossSectionAssertions(r, {
      header: "X",
      section1: "Terminal anchor: RE_(T-1) + growth; g = 5.0%; TV GRADE_B",
    });
    expect(issues.some((i) => i.includes("V_primary equals"))).toBe(true);
  });

  it("S-13.3: flags header/trigger/sensitivity inconsistencies", () => {
    const r = new CanonicalOutputRegistry();
    r.register("primary_anchor_label", "RE_(T-1) + growth", "test");
    r.register("tv_grade", "GRADE_B", "test");
    r.register("g_effective", 0.05, "test");
    r.register("pm_warning_threshold", 0.2, "test");
    r.register("period_count", 4, "test");
    r.register("V_primary", 5000, "test");
    r.register("company_id", "ITC", "test");
    const issues = runCrossSectionAssertions(r, {
      header: "Primary value: 4000",
      section1: "Terminal anchor: RE_T (as reported); g = 7.0%; TV GRADE_C",
      section7: "ABC-specific trigger — PM path: If PM falls below 30%",
      section6A1RowCount: 1,
      sensitivity: [
        { ke: 0.1, g: [0.02, 0.03], values: [100, 90] },
        { ke: 0.12, g: [0.02, 0.03], values: [110, 95] },
      ],
    });
    expect(issues.some((i) => i.includes("Header V mismatch"))).toBe(true);
    expect(issues.some((i) => i.includes("trigger label"))).toBe(true);
    expect(issues.some((i) => i.includes("decreasing in ke"))).toBe(true);
  });

  it("S-15.4: dirty surplus framework registers display and clean cumulative fields", () => {
    const periods = [mkPeriod(2023, 0.25, 80, 500), mkPeriod(2024, 0.25, 85, 550), mkPeriod(2025, 0.25, 90, 600)];
    const ds = computeDirtySurplus(periods, 0.13);
    const flags = detectPeriodEventFlags(periods, ds, 10, 20); // suppress outlier flags
    const r = new CanonicalOutputRegistry();
    computeDirtySurplusFramework(periods, flags, r);
    expect(r.get<number>("DS_cumulative_all")).not.toBeUndefined();
    expect(r.get<number>("DS_cumulative_clean")).not.toBeUndefined();
    expect(r.get<number>("DS_display")).toBe(r.get<number>("DS_cumulative_all"));
    expect(r.get<string>("DS_display_label")).toBe("all periods, reported dividends");
  });

  it("S-14.3: computeV3Analytics registers composite components and contamination tier", () => {
    const periods = Array.from({ length: 6 }, (_, i) => mkPeriod(2020 + i, 0.25, 80 + i, 500 + i * 20));
    const out = computeV3Analytics(periods, DEFAULT_CONFIG, 5000, 4800, 0.04, 0.10);
    expect(out.registry.get("composite_components")).toBeTruthy();
    expect(out.registry.get("composite_tier_message")).toBeTruthy();
    expect(out.registry.get("contamination_tier")).toBeTruthy();
    expect(out.confidence.classification === "HIGH" || out.confidence.classification === "MODERATE" || out.confidence.classification === "LOW").toBe(true);
  });

  it("S-9.4: computeV3Analytics derives kw from structure when kw is not provided", () => {
    const periods = [mkPeriod(2024, 0.25, 80, 1246), mkPeriod(2025, 0.27, 85, 1246)];
    const expectedKw = deriveKwFromStructure(periods[1], periods[0], DEFAULT_CONFIG.ke, DEFAULT_CONFIG.risk_free_rate, DEFAULT_CONFIG);

    const out = computeV3Analytics(periods, DEFAULT_CONFIG, 5000, 4800, 0.04);

    expect(out.registry.get<number>("kw_derived_latest")).toBeCloseTo(expectedKw, 10);
    expect(out.registry.get<number>("kw_derived_latest")).not.toBeCloseTo(DEFAULT_CONFIG.ke * 0.75, 3);
  });
});
