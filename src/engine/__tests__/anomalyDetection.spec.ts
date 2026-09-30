import { describe, expect, it } from "vitest";
import {
  runAnomalyDetection,
  detectDirtySurplusPerPeriod,
  detectDividendDiscrepancy,
  detectMetricStepChanges,
  detectComponentDisappearance,
  detectReclassification,
  detectPayoutAnomaly,
  classifyAccrualRegime,
  validateTerminalREAnchor,
  buildPeriodFlagSummary,
  computeContaminationTier,
} from "../anomalyDetection";
import { RecastPeriod, EngineConfig, Severity, SpecFlag } from "../types";
import { PercentFraction } from "../types/units";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ke: PercentFraction(0.12),
    kw: 0.10,
    g_terminal: 0.05,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.05,
    beta: 1.0,
    ...overrides,
  } as unknown as EngineConfig;
}

function makePeriod(
  period_end: string,
  overrides: {
    noa?: number;
    cse?: number;
    cni?: number;
    coreOI?: number;
    taxRate?: number;
    cfo?: number;
    capex?: number;
    fcf?: number;
    div?: number;
    buyback?: number;
    issuance?: number;
    rnoa?: number;
    spread?: number;
    sales?: number;
    oi?: number;
    ta?: number;
    fa?: number;
    oa?: number;
    ol?: number;
    pm?: number;
  } = {}
): RecastPeriod {
  const {
    noa = 1000, cse = 800, cni = 100, coreOI = 120,
    taxRate = 0.25, cfo = 110, capex = 30, fcf = 80,
    div = 40, buyback = 0, issuance = 0,
    rnoa = 0.15, spread = 0.05,
    sales = 800, oi = coreOI, ta = noa + 200,
    fa = 0, oa = noa, ol = 200, pm = 0.15,
  } = overrides;

  return {
    period_end,
    bs: {
      NOA: noa, CSE: cse,
      TA: ta, FA: fa, FO: 0, OA: oa, OL: ol,
      MI: 0, NFO: noa - cse,
      DTL: 0, PensionObl: 0, OL_ex_DTL: 200,
      Goodwill: 0, CurrentAssets: 300, CurrentLiabilities: 200,
      Inventory: 100, TradeReceivables: 100, TradePayables: 80,
      PPE: 500, LIFO_reserve: 0, separationScore: 1,
      OA_PPE: 500, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 100, OA_DTA: 0,
      OA_CWIP: 0, OA_Other: 0,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 60,
      OL_ProvisionsCurrent: 20, OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 5,
      OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 10,
      BridgeDebtTotal: noa - cse,
    },
    is: {
      Sales: sales, TaxExpense: cni * taxRate / (1 - taxRate),
      taxRate, PAT: cni, OCI: 0, TCI: cni, TCI_NCI: 0, CNI: cni,
      FinanceCost: 20, FinanceIncome: 0, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 20, OI: oi,
      OtherItems: 0, OI_from_sales: oi, MII: 0, COGS: 400,
    },
    cu: {
      UOI: 0, CoreOI: coreOI, UFE: 0, CoreNFE: 20,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    },
    cf: {
      CFO: cfo, Capex: capex,
      DividendPaid: div, EquityIssued: issuance, ShareBuybacks: buyback,
      InterestReceived: 0, DividendReceived: 0,
      FCF_accounting: cfo - capex, FCF_cash: fcf,
      d_t: div, d_t_formula: div, d_t_discrepancy: 0,
      EBITDA: coreOI + 30,
    },
    ratios: {
      RNOA: rnoa, SPREAD: spread,
      ROCE: rnoa, NBC: 0.05, FLEV: 0.25,
      PM: pm, ATO: 1.0, SalesPM: pm, ATO_star: 1.0,
      OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.05, ROOA: rnoa, OLLEV: 0, OLSPREAD: 0, RNOA_check: rnoa,
      ROTCE: rnoa, MSR: 0,
      CoreSalesPM: pm, CoreOtherItems_OA: 0, UOI_OA: 0,
      CoreNBC: 0.05, UFE_NFO: 0, CoreSPREAD: spread,
      ROCE_eq16_reconstructed: rnoa, ROCE_eq16_error: 0,
      eq16_step1_residual: 0, eq16_step2_residual: 0, eq16_step3_residual: 0,
      eq16_flag: "OK", eq16_diagnosis: null,
      ROOA_spec: rnoa, imputed_io_spec: 0.05,
      required_return_per_sales: null, value_creating_margin: null,
      CSE_eq8_check: null, CSE_eq8_error_pct: null,
      current_ratio: 1.5, quick_ratio: 1.0,
      days_receivable: 45, days_payable: 36, days_inventory: 90,
      cash_conversion_cycle: 99, accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.02,
      cash_conversion_ratio: 1.1, interest_coverage: 8,
      NOA_growth: 0.05, CNI_growth: 0.08, OI_growth: 0.08, Sales_growth: 0.08,
      noaSmall: false, separationScore: 1,
      accrual_regime: "NORMAL",
      dirty_surplus: 0, dirty_surplus_pct_cse: 0,
      freeOL: null, interestBearingOL: null,
      OLLEV_check: null, RNOA_vs_OLLEV_residual: null,
      employeeCostRatio: null,
    },
  } as RecastPeriod;
}

/**
 * Build a clean-surplus series: CSE_t = CSE_{t-1} + CNI - div, constant Sales,
 * constant ratios. With cni=100, div=40 → CSE grows by 60 each year and DS_t≈0.
 * No incremental-margin trigger (Sales constant), no metric outliers (ratios flat).
 */
function makeCleanSeries(n: number): RecastPeriod[] {
  const cni = 100;
  const div = 40;
  let cse = 800;
  const out: RecastPeriod[] = [];
  for (let i = 0; i < n; i++) {
    const year = 2012 + i;
    out.push(makePeriod(`${year}-03-31`, {
      cse,
      cni,
      div,
      noa: 1000 + i * 60,
      sales: 800,
      oi: 120,
      rnoa: 0.15,
      pm: 0.15,
    }));
    cse += cni - div;
  }
  return out;
}

// ─── runAnomalyDetection: clean series ──────────────────────────────────────

describe("runAnomalyDetection — clean surplus series", () => {
  it("returns a CLEAN contamination tier with no flags", () => {
    const periods = makeCleanSeries(8);
    const bundle = runAnomalyDetection(periods, makeConfig());

    expect(bundle.contamination.tier).toBe("CLEAN");
    expect(bundle.contamination.score).toBe(0);
    expect(bundle.contamination.n_flags).toBe(0);
    expect(bundle.contamination.primary_anchor).toBe("RE_T");
    expect(bundle.terminalFlags).toHaveLength(0);
    expect(Math.abs(bundle.cumulativeDS)).toBeLessThan(1e-6);
  });

  it("produces one dirty-surplus result per period transition", () => {
    const periods = makeCleanSeries(8);
    const bundle = runAnomalyDetection(periods, makeConfig());
    expect(bundle.dsSeries).toHaveLength(7);
    expect(bundle.periodSummaries).toHaveLength(8);
    expect(bundle.metricOutliers).toHaveLength(8);
  });

  it("returns the empty bundle for < 2 periods", () => {
    const bundle = runAnomalyDetection([], makeConfig());
    expect(bundle.dsSeries).toHaveLength(0);
    expect(bundle.contamination.tier).toBe("CLEAN");
    expect(bundle.contamination.message).toBe("Insufficient periods.");
    expect(bundle.cumulativeDS).toBe(0);
    expect(bundle.cumulativeDS_pct).toBe(0);
  });
});

// ─── detectDirtySurplusPerPeriod ────────────────────────────────────────────

describe("detectDirtySurplusPerPeriod", () => {
  it("flags a CRITICAL dirty-surplus spike on an unexplained CSE jump", () => {
    const periods = makeCleanSeries(3);
    // Inject a large unexplained CSE jump in the terminal period.
    periods[2]!.bs.CSE = periods[1]!.bs.CSE + 1000;
    const ds = detectDirtySurplusPerPeriod(periods, makeConfig());

    const last = ds[ds.length - 1]!;
    expect(last.period_end).toBe("2014-03-31");
    // ΔCSE(1000) - CNI(100) + div(40) = 940
    expect(last.DS_t).toBeCloseTo(940, 6);
    const crit = last.flags.find(f => f.severity === Severity.CRITICAL);
    expect(crit).toBeDefined();
    expect(crit!.spec_id).toBe("S-5.1");
    expect(crit!.label).toBe("STRUCTURAL_EVENT");
    expect(crit!.affects_terminal).toBe(true);
  });

  it("emits no flags for a clean-surplus transition", () => {
    const periods = makeCleanSeries(3);
    const ds = detectDirtySurplusPerPeriod(periods, makeConfig());
    expect(ds.every(r => r.flags.length === 0)).toBe(true);
  });

  // TCS-shaped: equity falls 1000 more than earnings less dividends, and the
  // export itemizes no buyback. Only the share count says what happened.
  const buybackYear = (sharesAfter: number) => {
    const periods = makeCleanSeries(3);
    periods[2]!.bs.CSE = periods[1]!.bs.CSE + 60 - 1000;
    periods[1]!.shareCountInput = { endPeriodShares: 366, faceValue: 1 } as RecastPeriod["shareCountInput"];
    periods[2]!.shareCountInput = { endPeriodShares: sharesAfter, faceValue: 1 } as RecastPeriod["shareCountInput"];
    return periods;
  };

  it("reads a shortfall with cancelled shares as a buyback, not a structural event", () => {
    const last = detectDirtySurplusPerPeriod(buybackYear(362), makeConfig()).at(-1)!;
    expect(last.DS_t).toBeCloseTo(-1000, 6);
    expect(last.flags.map(f => f.label)).toEqual(["BUYBACK_LIKELY"]);
    expect(last.flags[0]!.severity).toBe(Severity.WARNING);
    expect(last.flags[0]!.affects_terminal).toBe(false);
  });

  it("keeps the same shortfall structural when no shares were cancelled", () => {
    const last = detectDirtySurplusPerPeriod(buybackYear(366), makeConfig()).at(-1)!;
    expect(last.flags[0]!.label).toBe("STRUCTURAL_EVENT");
    expect(last.flags[0]!.affects_terminal).toBe(true);
  });

  it("nets share issues out of dirty surplus", () => {
    // DMart-shaped IPO: equity rises by 1000 of proceeds the cash-flow
    // statement itemizes, so payout d_t = dividends − issue.
    const periods = makeCleanSeries(3);
    periods[2]!.bs.CSE = periods[1]!.bs.CSE + 60 + 1000;
    periods[2]!.cf.EquityIssued = 1000;
    periods[2]!.cf.d_t = 40 - 1000;
    const last = detectDirtySurplusPerPeriod(periods, makeConfig()).at(-1)!;
    expect(last.DS_t).toBeCloseTo(0, 6);
    expect(last.flags).toHaveLength(0);
  });
});

// ─── detectDividendDiscrepancy ──────────────────────────────────────────────

describe("detectDividendDiscrepancy", () => {
  it("flags a capital-transaction discrepancy when DS is large", () => {
    const periods = makeCleanSeries(3);
    periods[2]!.bs.CSE = periods[1]!.bs.CSE + 1000;
    const ds = detectDirtySurplusPerPeriod(periods, makeConfig());
    const flags = detectDividendDiscrepancy(periods, ds, makeConfig());

    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]!.spec_id).toBe("S-5.2");
    expect(flags[0]!.label).toBe("CAPITAL_TRANSACTION_LIKELY");
    expect(flags[0]!.severity).toBe(Severity.WARNING);
  });

  it("stops an identified buyback from affecting the terminal period", () => {
    const periods = makeCleanSeries(3);
    periods[2]!.bs.CSE = periods[1]!.bs.CSE + 60 - 1000;
    periods[1]!.shareCountInput = { endPeriodShares: 366, faceValue: 1 } as RecastPeriod["shareCountInput"];
    periods[2]!.shareCountInput = { endPeriodShares: 362, faceValue: 1 } as RecastPeriod["shareCountInput"];
    const flags = detectDividendDiscrepancy(periods, detectDirtySurplusPerPeriod(periods, makeConfig()), makeConfig());
    expect(flags[0]!.label).toBe("CAPITAL_TRANSACTION_LIKELY");
    expect(flags[0]!.affects_terminal).toBe(false);
  });
});

// ─── detectMetricStepChanges ────────────────────────────────────────────────

describe("detectMetricStepChanges", () => {
  it("flags a critical PM outlier against a flat history", () => {
    const periods = makeCleanSeries(8);
    // Spike PM way outside historical band in the terminal period.
    periods[7]!.ratios!.PM = 0.95;
    const results = detectMetricStepChanges(periods, makeConfig());

    const terminal = results[7]!;
    const pmFlag = terminal.flags.find(f => f.label.startsWith("PM_OUTLIER"));
    expect(pmFlag).toBeDefined();
    expect(pmFlag!.spec_id).toBe("S-5.3");
    expect(pmFlag!.severity).toBe(Severity.CRITICAL);
    expect(terminal.pm_zscore).not.toBeNull();
  });

  it("leaves the terminal period eligible when profitability alone moves", () => {
    // A level far from history is often the business changing, not a
    // contaminated anchor: the flag is kept for review but does not block.
    const periods = makeCleanSeries(8);
    periods[7]!.ratios!.PM = 0.95;
    periods[7]!.ratios!.RNOA = 0.95;
    const pmFlag = detectMetricStepChanges(periods, makeConfig())[7]!.flags.find(f => f.label === "PM_OUTLIER_CRITICAL");
    expect(pmFlag?.affects_terminal).toBe(false);
    // Still listed among the terminal period's flags, but it scores nothing.
    expect(runAnomalyDetection(periods, makeConfig()).contamination.tier).toBe("CLEAN");
  });

  it("flags an incremental-margin anomaly on a revenue jump with one-time income", () => {
    const periods = makeCleanSeries(3);
    periods[2]!.is.Sales = periods[1]!.is.Sales + 100;
    periods[2]!.is.OI = periods[1]!.is.OI + 200; // incr margin = 200%
    const results = detectMetricStepChanges(periods, makeConfig());

    const flag = results[2]!.flags.find(f => f.label === "INCREMENTAL_MARGIN_ANOMALY");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe(Severity.CRITICAL);
    expect(results[2]!.incr_margin).toBeCloseTo(2.0, 6);
  });

  it("produces no metric flags for a flat series", () => {
    const periods = makeCleanSeries(8);
    const results = detectMetricStepChanges(periods, makeConfig());
    expect(results.every(r => r.flags.length === 0)).toBe(true);
  });
});

// ─── detectComponentDisappearance ───────────────────────────────────────────

describe("detectComponentDisappearance", () => {
  it("flags a large operating-asset decline", () => {
    const periods = makeCleanSeries(3);
    periods[2]!.bs.OA = periods[1]!.bs.OA * 0.5; // 50% drop
    const flags = detectComponentDisappearance(periods, makeConfig());

    const oaFlag = flags.find(f => f.label === "LARGE_OA_DECLINE");
    expect(oaFlag).toBeDefined();
    expect(oaFlag!.spec_id).toBe("S-5.4");
    expect(oaFlag!.severity).toBe(Severity.WARNING);
    expect(oaFlag!.affects_terminal).toBe(true);
  });

  it("produces no flags for stable components", () => {
    const periods = makeCleanSeries(3);
    const flags = detectComponentDisappearance(periods, makeConfig());
    expect(flags).toHaveLength(0);
  });

  it("lists a financial-asset decline for review without blocking the anchor", () => {
    // DMart-shaped: cash (FA) falls 50% as it is spent on stores.
    const periods = makeCleanSeries(3);
    periods[1]!.bs.FA = 400;
    periods[2]!.bs.FA = 200;
    const faFlag = detectComponentDisappearance(periods, makeConfig()).find(f => f.label === "LARGE_FA_DECLINE");
    expect(faFlag).toBeDefined();
    expect(faFlag!.affects_terminal).toBe(false);
  });

  it("does not block on a sub-line falling while total operating assets hold", () => {
    // Reliance-shaped: other operating assets move into PPE; OA is unchanged.
    const periods = makeCleanSeries(3);
    periods[1]!.bs.OA_Other = 300;
    periods[2]!.bs.OA_Other = 0;
    periods[2]!.bs.OA_PPE = periods[1]!.bs.OA_PPE + 300;
    periods[2]!.bs.OA = periods[1]!.bs.OA;
    const flags = detectComponentDisappearance(periods, makeConfig());
    const sub = flags.find(f => f.label === "LARGE_OtherOA_DECLINE");
    expect(sub).toBeDefined();
    expect(sub!.affects_terminal).toBe(false);
    expect(flags.some(f => f.affects_terminal)).toBe(false);
  });
});

// ─── detectReclassification ─────────────────────────────────────────────────

describe("detectReclassification", () => {
  it("flags an OA↔FA reclassification when components move in opposite directions", () => {
    const periods = makeCleanSeries(3);
    // Move 300 from OA into FA in terminal period (opposite directions, both big).
    // No cash moves, so NOA falls by 300 that the cash-flow statement never sees.
    periods[2]!.bs.OA = periods[1]!.bs.OA - 300;
    periods[2]!.bs.FA = periods[1]!.bs.FA + 300;
    periods[2]!.cf.FCF_accounting += 300;
    const flags = detectReclassification(periods, makeConfig());

    const reclass = flags.find(f => f.label === "POTENTIAL_RECLASSIFICATION");
    expect(reclass).toBeDefined();
    expect(reclass!.spec_id).toBe("S-5.5");
    expect(reclass!.severity).toBe(Severity.CRITICAL);
  });

  it("does not flag cash spent on operating assets", () => {
    // DMart-shaped: 300 of cash (FA) spent on stores (OA). Capex lowers free
    // cash flow on both measures alike, so nothing is left unexplained.
    const periods = makeCleanSeries(3);
    periods[2]!.bs.OA = periods[1]!.bs.OA + 300;
    periods[1]!.bs.FA = 1000;
    periods[2]!.bs.FA = 700;
    periods[2]!.cf.Capex += 300;
    periods[2]!.cf.FCF_cash -= 300;
    periods[2]!.cf.FCF_accounting -= 300;
    expect(detectReclassification(periods, makeConfig()).find(f => f.label === "POTENTIAL_RECLASSIFICATION")).toBeUndefined();
  });

  it("accepts a reported CFO of zero as cash-flow evidence", () => {
    // OI and CFO both 0, capex 300 paid from cash: both free-cash-flow
    // measures are −300, so nothing is unexplained.
    const periods = makeCleanSeries(3);
    periods[2]!.bs.OA = periods[1]!.bs.OA + 300;
    periods[1]!.bs.FA = 1000;
    periods[2]!.bs.FA = 700;
    Object.assign(periods[2]!.cf, { CFO: 0, Capex: 300, FCF_cash: -300, FCF_accounting: -300 });
    expect(detectReclassification(periods, makeConfig()).find(f => f.label === "POTENTIAL_RECLASSIFICATION")).toBeUndefined();
  });

  it("keeps the flag when the period has no cash-flow lines at all", () => {
    const periods = makeCleanSeries(3);
    periods[2]!.bs.OA = periods[1]!.bs.OA + 300;
    periods[1]!.bs.FA = 1000;
    periods[2]!.bs.FA = 700;
    Object.assign(periods[2]!.cf, { CFO: 0, Capex: 0, FCF_cash: 0, FCF_accounting: 400 });
    expect(detectReclassification(periods, makeConfig()).find(f => f.label === "POTENTIAL_RECLASSIFICATION")).toBeDefined();
  });
});

// ─── detectPayoutAnomaly ────────────────────────────────────────────────────

describe("detectPayoutAnomaly", () => {
  it("flags excess payout when dividend exceeds 110% of CNI", () => {
    const periods = [makePeriod("2020-03-31", { cni: 100, div: 130 })];
    const flags = detectPayoutAnomaly(periods);
    const f = flags.find(x => x.label === "EXCESS_PAYOUT");
    expect(f).toBeDefined();
    expect(f!.spec_id).toBe("S-5.6");
    expect(f!.severity).toBe(Severity.WARNING);
  });

  it("flags dividends paid despite a loss", () => {
    const periods = [makePeriod("2020-03-31", { cni: -50, div: 20 })];
    const flags = detectPayoutAnomaly(periods);
    const f = flags.find(x => x.label === "DIVIDEND_DESPITE_LOSS");
    expect(f).toBeDefined();
    expect(f!.severity).toBe(Severity.WARNING);
  });

  it("no payout flags when dividend is well within earnings", () => {
    const periods = [makePeriod("2020-03-31", { cni: 100, div: 40 })];
    expect(detectPayoutAnomaly(periods)).toHaveLength(0);
  });
});

// ─── classifyAccrualRegime ──────────────────────────────────────────────────

describe("classifyAccrualRegime", () => {
  it("classifies NORMAL when accrual ratio is small", () => {
    const cur = makePeriod("2020-03-31", { noa: 1060 });
    const prev = makePeriod("2019-03-31", { noa: 1000 });
    const r = classifyAccrualRegime(cur, prev, 0.05);
    expect(r.regime).toBe("NORMAL");
    expect(r.qualityConcern).toBe(false);
  });

  it("classifies GROWTH_ACCRUAL for high accruals with NOA growth", () => {
    const cur = makePeriod("2020-03-31", { noa: 1300 });
    const prev = makePeriod("2019-03-31", { noa: 1000 });
    const r = classifyAccrualRegime(cur, prev, 0.25);
    expect(r.regime).toBe("GROWTH_ACCRUAL");
    expect(r.qualityConcern).toBe(false);
  });

  it("classifies QUALITY_ACCRUAL for high accruals without NOA growth", () => {
    const cur = makePeriod("2020-03-31", { noa: 1010 });
    const prev = makePeriod("2019-03-31", { noa: 1000 });
    const r = classifyAccrualRegime(cur, prev, 0.25);
    expect(r.regime).toBe("QUALITY_ACCRUAL");
    expect(r.qualityConcern).toBe(true);
  });

  it("classifies ASSET_DISPOSAL for negative accruals with NOA reduction", () => {
    const cur = makePeriod("2020-03-31", { noa: 800, fa: 0 });
    const prev = makePeriod("2019-03-31", { noa: 1000, fa: 0 });
    const r = classifyAccrualRegime(cur, prev, -0.25);
    expect(r.regime).toBe("ASSET_DISPOSAL");
  });

  it("classifies CASH_ACCUMULATION for negative accruals with FA build-up", () => {
    const cur = makePeriod("2020-03-31", { noa: 1000, fa: 200 });
    const prev = makePeriod("2019-03-31", { noa: 1000, fa: 100 });
    const r = classifyAccrualRegime(cur, prev, -0.25);
    expect(r.regime).toBe("CASH_ACCUMULATION");
  });
});

// ─── validateTerminalREAnchor ───────────────────────────────────────────────

describe("validateTerminalREAnchor", () => {
  // With opening equity for every year, residual ROE (RE ÷ opening CSE) decides.
  const series = (points: Array<[number, number]>) =>
    points.map(([RE, openingCSE], i) => ({ period: `${2019 + i}-03-31`, RE, ReOI: 0, openingCSE }));

  it("does not read steady growth as a non-recurring terminal year", () => {
    // Infosys-shaped: equity and RE both compound, so RE_T is 2.5× the
    // whole-history median while residual ROE moves 16% → 22%.
    const v = validateTerminalREAnchor(series([
      [5000, 40000], [6000, 42000], [7500, 46000], [8449, 52000], [11000, 70000], [15500, 83000], [21156, 95700],
    ]), makeConfig());
    expect(v.anchor_vs_median).toBeGreaterThanOrEqual(2.5);
    expect(v.terminal_anomaly).toBe(false);
  });

  it("flags a terminal residual ROE that swells past its history and last year", () => {
    // ITC FY25-shaped: a demerger gain lifts residual ROE to 32% against a
    // 16% median and 20% last year.
    const v = validateTerminalREAnchor(series([
      [9000, 60000], [9500, 62000], [10200, 65000], [11000, 70000], [15000, 74000], [23989, 74500],
    ]), makeConfig());
    expect(v.terminal_anomaly).toBe(true);
    expect(v.flags[0]!.message).toMatch(/Residual ROE 32\.2%/);
  });

  it("does not flag a fall in residual ROE", () => {
    // Asian Paints FY25-shaped: 23% → 9% is a weaker business, not a one-off
    // that inflates the anchor.
    const v = validateTerminalREAnchor(series([
      [3000, 15000], [3500, 17000], [3900, 18000], [4300, 18600], [1723, 18700],
    ]), makeConfig());
    expect(v.terminal_anomaly).toBe(false);
  });

  it("returns a benign result for a stable RE series", () => {
    const re = [
      { period: "2018-03-31", RE: 100, ReOI: 0 },
      { period: "2019-03-31", RE: 110, ReOI: 0 },
      { period: "2020-03-31", RE: 120, ReOI: 0 },
    ];
    const v = validateTerminalREAnchor(re, makeConfig());
    expect(v.terminal_anomaly).toBe(false);
    expect(v.flags).toHaveLength(0);
    expect(v.RE_T).toBe(120);
  });

  it("flags a terminal RE anomaly when RE_T jumps vs prior", () => {
    const re = [
      { period: "2018-03-31", RE: 100, ReOI: 0 },
      { period: "2019-03-31", RE: 100, ReOI: 0 },
      { period: "2020-03-31", RE: 500, ReOI: 0 },
    ];
    const v = validateTerminalREAnchor(re, makeConfig());
    expect(v.terminal_anomaly).toBe(true);
    expect(v.flags.some(f => f.label === "TERMINAL_RE_ANOMALY")).toBe(true);
    expect(v.flags.every(f => f.spec_id === "S-10.1")).toBe(true);
  });

  it("does not flag a ratio jump that is immaterial against equity (RE near zero)", () => {
    // L&T FY26-shaped: owners' ROE ≈ ke, so the median RE is ₹487 Cr and an
    // ordinary ₹2,989 Cr year is "6.1× the median" — a 2.6-ROE-point move on
    // ₹97,656 Cr of opening equity.
    const re = [
      { period: "2023-03-31", RE: 300, ReOI: 0 },
      { period: "2024-03-31", RE: 487, ReOI: 0 },
      { period: "2025-03-31", RE: 900, ReOI: 0 },
      { period: "2026-03-31", RE: 2989, ReOI: 0, openingCSE: 97656 },
    ];
    const v = validateTerminalREAnchor(re, makeConfig());
    expect(v.anchor_vs_median).toBeGreaterThan(2.5);
    expect(v.terminal_anomaly).toBe(false);
    expect(v.flags).toHaveLength(0);
  });

  it("still flags a ratio jump that is material against equity", () => {
    // Grasim FY25-shaped: RE −₹1,191 → −₹8,246 Cr on ₹88,652 Cr — 8 ROE points.
    const re = [
      { period: "2023-03-31", RE: -900, ReOI: 0 },
      { period: "2024-03-31", RE: -1191, ReOI: 0 },
      { period: "2025-03-31", RE: -8246, ReOI: 0, openingCSE: 88652 },
    ];
    const v = validateTerminalREAnchor(re, makeConfig());
    expect(v.terminal_anomaly).toBe(true);
    expect(v.flags.some((f) => f.label === "TERMINAL_RE_ANOMALY")).toBe(true);
  });

  it("keeps the ratio tests alone when no equity basis is supplied", () => {
    // Callers without an equity basis get the previous behaviour.
    const re = [
      { period: "2023-03-31", RE: 300, ReOI: 0 },
      { period: "2024-03-31", RE: 487, ReOI: 0 },
      { period: "2025-03-31", RE: 900, ReOI: 0 },
      { period: "2026-03-31", RE: 2989, ReOI: 0 },
    ];
    expect(validateTerminalREAnchor(re, makeConfig()).terminal_anomaly).toBe(true);
  });

  it("returns an empty validation for an empty series", () => {
    const v = validateTerminalREAnchor([], makeConfig());
    expect(v.RE_T).toBe(0);
    expect(v.RE_prev).toBeNull();
    expect(v.flags).toHaveLength(0);
  });
});

// ─── buildPeriodFlagSummary ─────────────────────────────────────────────────

describe("buildPeriodFlagSummary", () => {
  it("aggregates flags for the matching period and computes flag_score", () => {
    const period = "2020-03-31";
    const crit: SpecFlag = {
      spec_id: "S-5.1", severity: Severity.CRITICAL, label: "STRUCTURAL_EVENT",
      message: "", affects_terminal: true, period,
    };
    const warn: SpecFlag = {
      spec_id: "S-5.6", severity: Severity.WARNING, label: "EXCESS_PAYOUT",
      message: "", affects_terminal: false, period,
    };
    const other: SpecFlag = {
      spec_id: "S-5.6", severity: Severity.WARNING, label: "OTHER",
      message: "", affects_terminal: false, period: "2019-03-31",
    };
    const summary = buildPeriodFlagSummary(period, [crit, warn], [other]);
    expect(summary.all_flags).toHaveLength(2);
    expect(summary.n_critical).toBe(1);
    expect(summary.n_warning).toBe(1);
    expect(summary.flag_score).toBe(3); // 1*2 + 1
    expect(summary.labels).toEqual(["STRUCTURAL_EVENT", "EXCESS_PAYOUT"]);
  });
});

// ─── computeContaminationTier ───────────────────────────────────────────────

describe("computeContaminationTier", () => {
  const mk = (severity: Severity, affects_terminal: boolean): SpecFlag => ({
    spec_id: "S-5.1", severity, label: "X", message: "",
    affects_terminal, period: "2020-03-31",
  });

  it("returns CLEAN for no terminal-affecting flags", () => {
    const r = computeContaminationTier([mk(Severity.WARNING, false)]);
    expect(r.tier).toBe("CLEAN");
    expect(r.score).toBe(0);
    expect(r.primary_anchor).toBe("RE_T");
  });

  it("returns CAUTION for score 1-2", () => {
    const r = computeContaminationTier([mk(Severity.WARNING, true)]);
    expect(r.tier).toBe("CAUTION");
    expect(r.score).toBe(1);
    expect(r.primary_anchor).toBe("RE_T");
  });

  it("returns GUARDED for score 3-4", () => {
    const r = computeContaminationTier([mk(Severity.CRITICAL, true), mk(Severity.WARNING, true)]);
    expect(r.tier).toBe("GUARDED");
    expect(r.score).toBe(3);
    expect(r.primary_anchor).toBe("RE_T_MINUS_1_GROWN");
  });

  it("returns COMPROMISED for score > 4", () => {
    const r = computeContaminationTier([
      mk(Severity.CRITICAL, true),
      mk(Severity.CRITICAL, true),
      mk(Severity.WARNING, true),
    ]);
    expect(r.tier).toBe("COMPROMISED");
    expect(r.score).toBe(5);
    expect(r.primary_anchor).toBe("RE_T_MINUS_1_GROWN");
  });
});
