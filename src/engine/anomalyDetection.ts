/**
 * Anomaly Detection Module — V2-FINAL Spec Implementation
 *
 * Implements:
 *   S-5.1  Dirty Surplus Spike (per period)
 *   S-5.2  Dividend Discrepancy Gate
 *   S-5.3  Metric Step-Change Detection (incl. incremental margin)
 *   S-5.4  Large Asset/Liability Disappearance
 *   S-5.5  Reclassification Detection
 *   S-5.6  Payout Ratio Anomaly
 *   S-5.7  Period Flag Summary and Cascading Score
 *   S-6.3  Accrual Regime Classification
 *   S-10.2 Contamination Tier System
 *   S-10.1 Terminal RE Anchor Validation
 */

import { RecastPeriod, SpecFlag, Severity, ContaminationResult, ContaminationTier, EngineConfig } from "./types";

/* ── Helpers ────────────────────────────────────────────────────── */

function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function madStddev(vals: number[]): number {
  const med = medianOf(vals);
  if (med == null) return 0.001;
  const mad = medianOf(vals.map(v => Math.abs(v - med))) ?? 0.001;
  return Math.max(mad * 1.4826, 0.001); // MAD × 1.4826 ≈ robust σ
}

function flag(
  spec_id: string, severity: Severity, label: string,
  message: string, affects_terminal: boolean, period: string
): SpecFlag {
  return { spec_id, severity, label, message, affects_terminal, period };
}

/* ── S-5.1 Dirty Surplus Spike ──────────────────────────────────── */

export interface DirtySurplusResult {
  period_end        : string;
  DS_t              : number;
  ΔCSE              : number;
  CNI_t             : number;
  DividendsPaid     : number;
  DS_pct_CSE        : number;
  flags             : SpecFlag[];
}

export function detectDirtySurplusPerPeriod(
  periods: RecastPeriod[],
  cfg: EngineConfig
): DirtySurplusResult[] {
  const warn_pct  = cfg.DS_warning_pct  ?? 0.05;
  const crit_pct  = cfg.DS_critical_pct ?? 0.10;
  const results: DirtySurplusResult[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i];
    const prev = periods[i - 1];

    const CSE_t  = cur.bs.CSE;
    const CSE_t1 = prev.bs.CSE;
    const CNI_t  = cur.is.CNI;
    const div    = cur.cf.DividendPaid;

    const ΔCSE   = CSE_t - CSE_t1;
    const DS_t   = ΔCSE - CNI_t + div;
    const abs_DS = Math.abs(DS_t);
    const DS_pct = Math.max(Math.abs(CSE_t1), 1) > 0 ? abs_DS / Math.max(Math.abs(CSE_t1), 1) : 0;

    const threshold_warn = Math.max(
      warn_pct * Math.abs(CSE_t1),
      warn_pct * 0.6 * Math.max(prev.bs.TA, 1)
    );
    const threshold_crit = Math.max(
      crit_pct * Math.abs(CSE_t1),
      crit_pct * 0.6 * Math.max(prev.bs.TA, 1)
    );

    const flags: SpecFlag[] = [];

    if (abs_DS > threshold_crit) {
      flags.push(flag(
        "S-5.1", Severity.CRITICAL, "STRUCTURAL_EVENT",
        `Dirty surplus = ₹${DS_t.toFixed(0)} Cr (${(DS_pct * 100).toFixed(1)}% of CSE). ` +
        `Typically indicates a demerger, buyback, scheme of arrangement, or Ind AS ` +
        `transition adjustment. Period should not anchor terminal value without review.`,
        true, cur.period_end
      ));
    } else if (abs_DS > threshold_warn) {
      flags.push(flag(
        "S-5.1", Severity.WARNING, "CLEAN_SURPLUS_VIOLATED",
        `Dirty surplus = ₹${DS_t.toFixed(0)} Cr (${(DS_pct * 100).toFixed(1)}% of CSE). ` +
        `Likely OCI accumulation, ESOP charges through reserves, or minor equity transaction.`,
        false, cur.period_end
      ));
    }

    results.push({ period_end: cur.period_end, DS_t, ΔCSE, CNI_t, DividendsPaid: div, DS_pct_CSE: DS_pct, flags });
  }
  return results;
}

/* ── S-5.2 Dividend Discrepancy Gate ────────────────────────────── */

export function detectDividendDiscrepancy(
  periods: RecastPeriod[],
  dsSeries: DirtySurplusResult[],
  cfg: EngineConfig
): SpecFlag[] {
  const disc_pct = cfg.div_disc_pct ?? 0.20;
  const warn_pct = cfg.DS_warning_pct ?? 0.05;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur   = periods[i];
    const prev  = periods[i - 1];
    const ds    = dsSeries[i - 1];
    const disc  = -ds.DS_t; // algebraically disc = −DS
    const abs_d = Math.abs(disc);

    const threshold = Math.max(
      disc_pct * Math.abs(cur.is.CNI),
      warn_pct * Math.abs(prev.bs.CSE)
    );

    if (abs_d > threshold) {
      flags.push(flag(
        "S-5.2", Severity.WARNING, "CAPITAL_TRANSACTION_LIKELY",
        `Dividend discrepancy = ₹${disc.toFixed(0)} Cr ` +
        `(${cur.is.CNI !== 0 ? (disc / cur.is.CNI * 100).toFixed(0) : "∞"}% of CNI). ` +
        `Indicates a capital transaction (demerger, buyback, bonus issue, or equity adjustment) ` +
        `not captured in reported dividends.`,
        true, cur.period_end
      ));
    }
  }
  return flags;
}

/* ── S-5.3 Metric Step-Change Detection ─────────────────────────── */

export interface MetricOutlierResult {
  period_end: string;
  flags: SpecFlag[];
  pm_zscore: number | null;
  rnoa_zscore: number | null;
  roce_zscore: number | null;
  incr_margin: number | null;
}

export function detectMetricStepChanges(
  periods: RecastPeriod[],
  cfg: EngineConfig
): MetricOutlierResult[] {
  const z_warn = cfg.metric_z_warning ?? 2.0;
  const z_crit = cfg.metric_z_critical ?? 3.0;
  const im_upper = cfg.incr_margin_upper ?? 1.00;
  const im_lower = cfg.incr_margin_lower ?? -0.50;

  const pmSeries   = periods.map(p => p.ratios?.PM   ?? null);
  const rnoa_series= periods.map(p => p.ratios?.RNOA  ?? null);
  const roce_series= periods.map(p => p.ratios?.ROCE  ?? null);

  const results: MetricOutlierResult[] = [];

  for (let i = 0; i < periods.length; i++) {
    const cur = periods[i];
    const flags: SpecFlag[] = [];
    let pm_z: number|null = null, rnoa_z: number|null = null, roce_z: number|null = null;
    let incr_margin: number|null = null;

    if (i >= 4) {
      // Compute robust z-score using prior periods (excluding current)
      const priorPM   = pmSeries.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v));
      const priorRNOA = rnoa_series.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v) && !(periods[periods.indexOf(periods[i])]?.ratios?.noaSmall));
      const priorROCE = roce_series.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v));

      const checkMetric = (
        label: string, val: number|null|undefined,
        prior: number[], specId: string
      ): number | null => {
        if (!prior || prior.length < 4 || val == null) return null;
        const μ = medianOf(prior)!;
        const σ = madStddev(prior);
        const z = (val - μ) / σ;
        if (Math.abs(z) > z_crit) {
          flags.push(flag(specId, Severity.CRITICAL, `${label}_OUTLIER_CRITICAL`,
            `${label} = ${(val * 100).toFixed(1)}% vs median ${(μ * 100).toFixed(1)}% (z = ${z.toFixed(1)}). ` +
            `Exceeds 3σ of historical variability.`,
            true, cur.period_end));
        } else if (Math.abs(z) > z_warn) {
          flags.push(flag(specId, Severity.WARNING, `${label}_OUTLIER_WARNING`,
            `${label} = ${(val * 100).toFixed(1)}% vs median ${(μ * 100).toFixed(1)}% (z = ${z.toFixed(1)}).`,
            false, cur.period_end));
        }
        return z;
      };

      pm_z   = checkMetric("PM",   pmSeries[i],   priorPM,   "S-5.3");
      roce_z = checkMetric("ROCE", roce_series[i], priorROCE, "S-5.3");
      if (!cur.ratios?.noaSmall) {
        rnoa_z = checkMetric("RNOA", rnoa_series[i], priorRNOA, "S-5.3");
      }
    }

    // Incremental margin anomaly
    if (i > 0) {
      const prev = periods[i - 1];
      const ΔRev = cur.is.Sales - prev.is.Sales;
      if (ΔRev > 0) {
        const ΔOI = cur.is.OI - prev.is.OI;
        incr_margin = ΔOI / ΔRev;
        if (incr_margin > im_upper || incr_margin < im_lower) {
          flags.push(flag(
            "S-5.3", Severity.CRITICAL, "INCREMENTAL_MARGIN_ANOMALY",
            `Incremental margin = ${(incr_margin * 100).toFixed(0)}% ` +
            `(ΔOI ₹${ΔOI.toFixed(0)} / ΔRev ₹${ΔRev.toFixed(0)}). ` +
            `Values outside [${(im_lower * 100).toFixed(0)}%, ${(im_upper * 100).toFixed(0)}%] ` +
            `suggest one-time income/expense in this period.`,
            true, cur.period_end
          ));
        }
      }
    }

    results.push({ period_end: cur.period_end, flags, pm_zscore: pm_z, rnoa_zscore: rnoa_z, roce_zscore: roce_z, incr_margin });
  }
  return results;
}

/* ── S-5.4 Large Asset/Liability Disappearance ───────────────────── */

export function detectComponentDisappearance(
  periods: RecastPeriod[],
  cfg: EngineConfig
): SpecFlag[] {
  const decline_pct  = cfg.comp_decline_pct ?? 0.15;
  const decline_abs  = cfg.comp_decline_abs_pct ?? 0.02;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i];
    const prev = periods[i - 1];
    const TA_prev = Math.max(prev.bs.TA, 1);

    type BSKey = "OA" | "FA" | "OL" | "FO";
    const components: BSKey[] = ["OA", "FA", "OL", "FO"];

    for (const C of components) {
      const prev_val = prev.bs[C];
      const cur_val  = cur.bs[C];
      const ΔC = cur_val - prev_val;
      if (
        ΔC < -(decline_pct * Math.max(prev_val, 1)) &&
        Math.abs(ΔC) > decline_abs * TA_prev
      ) {
        const affects = C === "OA" || C === "FA";
        flags.push(flag(
          "S-5.4", Severity.WARNING, `LARGE_${C}_DECLINE`,
          `Δ${C} = ₹${ΔC.toFixed(0)} Cr (${((ΔC / Math.max(prev_val, 1)) * 100).toFixed(0)}% of prior). ` +
          `Possible divestiture, impairment, or reclassification.`,
          affects, cur.period_end
        ));
      }
    }

    // Sub-component level (OA decomposition)
    const subComponents: Array<{key: keyof typeof cur.bs; label: string}> = [
      { key: "OA_PPE",           label: "PPE" },
      { key: "OA_Inventory",     label: "Inventory" },
      { key: "OA_TradeReceivables", label: "TradeReceivables" },
      { key: "OA_Goodwill",      label: "Goodwill" },
      { key: "OA_Other",         label: "OtherOA" },
    ];

    for (const { key, label } of subComponents) {
      const prev_val = (prev.bs as any)[key] as number ?? 0;
      const cur_val  = (cur.bs as any)[key]  as number ?? 0;
      const Δsub = cur_val - prev_val;
      if (
        Δsub < -(decline_pct * Math.max(prev_val, 1)) &&
        Math.abs(Δsub) > decline_abs * TA_prev
      ) {
        flags.push(flag(
          "S-5.4", Severity.WARNING, `LARGE_${label}_DECLINE`,
          `Δ${label} = ₹${Δsub.toFixed(0)} Cr. May indicate asset disposal or demerger of a business segment.`,
          true, cur.period_end
        ));
      }
    }
  }
  return flags;
}

/* ── S-5.5 Reclassification Detection ───────────────────────────── */

export function detectReclassification(
  periods: RecastPeriod[],
  cfg: EngineConfig
): SpecFlag[] {
  const reclassif_pct = cfg.reclassif_pct ?? 0.10;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i];
    const prev = periods[i - 1];

    const ΔOA = cur.bs.OA - prev.bs.OA;
    const ΔFA = cur.bs.FA - prev.bs.FA;

    const oppDirection = Math.sign(ΔOA) !== Math.sign(ΔFA) && ΔOA !== 0 && ΔFA !== 0;
    const bigOA = Math.abs(ΔOA) > reclassif_pct * Math.max(prev.bs.OA, 1);
    const bigFA = Math.abs(ΔFA) > reclassif_pct * Math.max(prev.bs.FA, 1);

    if (oppDirection && bigOA && bigFA) {
      const dateStr = cur.period_end.slice(0, 10);
      const indASWindow = dateStr >= "2016-03-31" && dateStr <= "2018-03-31";
      flags.push(flag(
        "S-5.5", Severity.CRITICAL, "POTENTIAL_RECLASSIFICATION",
        `₹${Math.min(Math.abs(ΔOA), Math.abs(ΔFA)).toFixed(0)} Cr appears to have moved between OA and FA ` +
        `(ΔOA = ₹${ΔOA.toFixed(0)}, ΔFA = ₹${ΔFA.toFixed(0)}). ` +
        `May reflect an accounting standard transition (Ind AS), reclassification of investments, or demerger. ` +
        `Ratios using NOA as denominator may not be comparable across this boundary.` +
        (indASWindow ? " Period falls within the typical Ind AS transition window (FY2016–2018)." : ""),
        true, cur.period_end
      ));
    }
  }
  return flags;
}

/* ── S-5.6 Payout Ratio Anomaly ─────────────────────────────────── */

export function detectPayoutAnomaly(periods: RecastPeriod[]): SpecFlag[] {
  const flags: SpecFlag[] = [];
  for (const p of periods) {
    const cni = p.is.CNI;
    const div = p.cf.DividendPaid;
    if (cni > 0 && div > 1.10 * cni) {
      flags.push(flag(
        "S-5.6", Severity.WARNING, "EXCESS_PAYOUT",
        `Dividend/CNI = ${(div / cni * 100).toFixed(0)}%. ` +
        `Company distributed more than current earnings, drawing on reserves or retained earnings.`,
        false, p.period_end
      ));
    }
    if (cni < 0 && div > 0) {
      flags.push(flag(
        "S-5.6", Severity.WARNING, "DIVIDEND_DESPITE_LOSS",
        `Dividends of ₹${div.toFixed(0)} Cr paid despite negative CNI of ₹${cni.toFixed(0)} Cr.`,
        false, p.period_end
      ));
    }
  }
  return flags;
}

/* ── S-6.3 Accrual Regime Classification ────────────────────────── */

export type AccrualRegime =
  | "GROWTH_ACCRUAL" | "QUALITY_ACCRUAL"
  | "CASH_ACCUMULATION" | "ASSET_DISPOSAL"
  | "CASH_GENERATION"  | "NORMAL";

export function classifyAccrualRegime(
  cur: RecastPeriod,
  prev: RecastPeriod,
  accrual_ratio: number
): { regime: AccrualRegime; interpretation: string; qualityConcern: boolean } {
  const ΔNOA    = cur.bs.NOA - prev.bs.NOA;
  const ΔNOA_pct = Math.abs(prev.bs.NOA) > 1 ? ΔNOA / Math.abs(prev.bs.NOA) : 0;
  const ΔFA_pct  = prev.bs.FA > 1 ? (cur.bs.FA - prev.bs.FA) / prev.bs.FA : 0;
  const threshold = 0.10;

  if (Math.abs(accrual_ratio) <= 0.10) {
    return { regime: "NORMAL", interpretation: "Accrual ratio within normal range.", qualityConcern: false };
  }

  if (accrual_ratio > 0.10) {
    if (ΔNOA_pct > threshold) {
      return {
        regime: "GROWTH_ACCRUAL",
        interpretation: `High accruals driven by operating asset investment (ΔNOA ₹${ΔNOA.toFixed(0)} Cr, +${(ΔNOA_pct * 100).toFixed(0)}%). Likely benign if supported by revenue growth.`,
        qualityConcern: false,
      };
    }
    return {
      regime: "QUALITY_ACCRUAL",
      interpretation: `High accruals without proportional NOA growth. May indicate aggressive revenue recognition or capitalisation policy.`,
      qualityConcern: true,
    };
  }

  // Negative accruals
  if (ΔFA_pct > threshold) {
    return {
      regime: "CASH_ACCUMULATION",
      interpretation: `Negative accruals from cash/FA build-up. Operating assets stable; excess cash flowing to financial assets.`,
      qualityConcern: false,
    };
  }
  if (ΔNOA_pct < -threshold) {
    return {
      regime: "ASSET_DISPOSAL",
      interpretation: `Negative accruals from operating asset reduction. Possible divestiture, impairment, or demerger.`,
      qualityConcern: false,
    };
  }
  return { regime: "CASH_GENERATION", interpretation: "Modest negative accruals; healthy cash generation.", qualityConcern: false };
}

/* ── S-10.1 Terminal RE Anchor Validation ───────────────────────── */

export interface TerminalREValidation {
  RE_T       : number;
  RE_prev    : number | null;
  RE_median  : number | null;
  anchor_jump: number | null;
  anchor_vs_median: number | null;
  terminal_anomaly: boolean;
  flags: SpecFlag[];
}

export function validateTerminalREAnchor(
  reSeries: Array<{period:string; RE:number; ReOI:number}>,
  cfg: EngineConfig
): TerminalREValidation {
  const jump_thresh   = cfg.re_anchor_jump   ?? 2.0;
  const median_thresh = cfg.re_anchor_median ?? 2.5;

  if (!reSeries || reSeries.length === 0) {
    return { RE_T: 0, RE_prev: null, RE_median: null, anchor_jump: null, anchor_vs_median: null, terminal_anomaly: false, flags: [] };
  }

  const n = reSeries.length;
  const RE_T    = reSeries[n - 1].RE;
  const RE_prev = n >= 2 ? reSeries[n - 2].RE : null;
  const reVals  = reSeries.map(r => r.RE).filter(Number.isFinite);
  const RE_median = medianOf(reVals);

  const anchor_jump        = RE_prev != null && Math.abs(RE_prev) > 1 ? Math.abs(RE_T / RE_prev) : null;
  const anchor_vs_median   = RE_median != null && Math.abs(RE_median) > 1 ? Math.abs(RE_T / RE_median) : null;

  const flags: SpecFlag[] = [];
  let terminal_anomaly = false;
  const latest_period  = reSeries[n - 1].period;

  if (anchor_jump != null && anchor_jump > jump_thresh) {
    terminal_anomaly = true;
    flags.push(flag(
      "S-10.1", Severity.CRITICAL, "TERMINAL_RE_ANOMALY",
      `RE_T (₹${RE_T.toFixed(0)}) is ${anchor_jump.toFixed(1)}× RE_T-1 ` +
      `(₹${RE_prev!.toFixed(0)}). Terminal period earnings appear non-recurring.`,
      true, latest_period
    ));
  }
  if (anchor_vs_median != null && anchor_vs_median > median_thresh) {
    terminal_anomaly = true;
    flags.push(flag(
      "S-10.1", Severity.CRITICAL, "TERMINAL_RE_ANOMALY",
      `RE_T is ${anchor_vs_median.toFixed(1)}× the sample median RE (₹${RE_median!.toFixed(0)} Cr).`,
      true, latest_period
    ));
  }

  return { RE_T, RE_prev, RE_median, anchor_jump, anchor_vs_median, terminal_anomaly, flags };
}

/* ── S-5.7 Period Flag Summary ──────────────────────────────────── */

export interface PeriodFlagSummary {
  period_end  : string;
  all_flags   : SpecFlag[];
  n_critical  : number;
  n_warning   : number;
  n_info      : number;
  flag_score  : number;
  labels      : string[];
}

export function buildPeriodFlagSummary(
  period_end: string,
  ...flagArrays: SpecFlag[][]
): PeriodFlagSummary {
  const all_flags = flagArrays.flat().filter(f => f.period === period_end);
  const n_critical = all_flags.filter(f => f.severity === Severity.CRITICAL).length;
  const n_warning  = all_flags.filter(f => f.severity === Severity.WARNING).length;
  const n_info     = all_flags.filter(f => f.severity === Severity.INFO).length;
  const flag_score = n_critical * 2 + n_warning;
  const labels     = all_flags.filter(f => f.severity >= Severity.WARNING).map(f => f.label);
  return { period_end, all_flags, n_critical, n_warning, n_info, flag_score, labels };
}

/* ── S-10.2 Contamination Tier System ───────────────────────────── */

export function computeContaminationTier(
  terminalPeriodFlags: SpecFlag[]
): ContaminationResult {
  const terminal = terminalPeriodFlags.filter(f => f.affects_terminal);
  const n_critical = terminal.filter(f => f.severity === Severity.CRITICAL).length;
  const n_warning  = terminal.filter(f => f.severity === Severity.WARNING).length;
  const score = n_critical * 2 + n_warning;
  const n_flags = terminal.length;
  const flag_labels = terminal.map(f => f.label);

  let tier: ContaminationTier;
  let primary_anchor: "RE_T" | "RE_T_MINUS_1_GROWN";
  let message: string;

  if (score === 0) {
    tier = "CLEAN";
    primary_anchor = "RE_T";
    message = "Terminal period clean. CV3 uses as-reported RE_T.";
  } else if (score <= 2) {
    tier = "CAUTION";
    primary_anchor = "RE_T";
    message = `Terminal period has ${n_flags} flag(s). CV3 usable with noted caveat.`;
  } else if (score <= 4) {
    tier = "GUARDED";
    primary_anchor = "RE_T_MINUS_1_GROWN";
    message = `Terminal period has ${n_flags} flags (score ${score}). Primary valuation uses RE_T-1+growth anchor. As-reported shown for reference.`;
  } else {
    tier = "COMPROMISED";
    primary_anchor = "RE_T_MINUS_1_GROWN";
    message = `Terminal period structurally compromised (${n_flags} flags, score ${score}). Primary valuation uses prior-period anchor. As-reported CV3 shown for reference only.`;
  }

  return { tier, score, n_flags, n_critical, n_warning, primary_anchor, message, flag_labels };
}

/* ── Full Anomaly Pipeline ──────────────────────────────────────── */

export interface AnomalyBundle {
  dsSeries         : DirtySurplusResult[];
  divDiscFlags     : SpecFlag[];
  metricOutliers   : MetricOutlierResult[];
  componentDecline : SpecFlag[];
  reclassification : SpecFlag[];
  payoutAnomaly    : SpecFlag[];
  /** All flags for the latest (terminal) period */
  terminalFlags    : SpecFlag[];
  contamination    : ContaminationResult;
  /** Per-period flag summaries */
  periodSummaries  : PeriodFlagSummary[];
  /** Cumulative dirty surplus */
  cumulativeDS     : number;
  cumulativeDS_pct : number;
}

export function runAnomalyDetection(
  periods: RecastPeriod[],
  cfg: EngineConfig,
  reSeries?: Array<{period:string;RE:number;ReOI:number}>
): AnomalyBundle {
  if (periods.length < 2) {
    const empty: ContaminationResult = {
      tier: "CLEAN", score: 0, n_flags: 0, n_critical: 0, n_warning: 0,
      primary_anchor: "RE_T", message: "Insufficient periods.", flag_labels: [],
    };
    return {
      dsSeries: [], divDiscFlags: [], metricOutliers: [], componentDecline: [],
      reclassification: [], payoutAnomaly: [], terminalFlags: [], contamination: empty,
      periodSummaries: [], cumulativeDS: 0, cumulativeDS_pct: 0,
    };
  }

  const dsSeries        = detectDirtySurplusPerPeriod(periods, cfg);
  const divDiscFlags    = detectDividendDiscrepancy(periods, dsSeries, cfg);
  const metricOutliers  = detectMetricStepChanges(periods, cfg);
  const componentDecline = detectComponentDisappearance(periods, cfg);
  const reclassification = detectReclassification(periods, cfg);
  const payoutAnomaly   = detectPayoutAnomaly(periods);

  // RE anchor validation if reSeries provided
  let reAnchorFlags: SpecFlag[] = [];
  if (reSeries && reSeries.length > 0) {
    const reValidation = validateTerminalREAnchor(reSeries, cfg);
    reAnchorFlags = reValidation.flags;
  }

  // Cumulative dirty surplus
  const cumulativeDS = dsSeries.reduce((s, r) => s + r.DS_t, 0);
  const terminalCSE  = Math.max(Math.abs(periods[periods.length - 1].bs.CSE), 1);
  const cumulativeDS_pct = Math.abs(cumulativeDS) / terminalCSE;

  // Build per-period summaries
  const allFlagsFlat: SpecFlag[] = [
    ...dsSeries.flatMap(r => r.flags),
    ...divDiscFlags,
    ...metricOutliers.flatMap(r => r.flags),
    ...componentDecline,
    ...reclassification,
    ...payoutAnomaly,
    ...reAnchorFlags,
  ];

  const periodSummaries = periods.map(p =>
    buildPeriodFlagSummary(
      p.period_end,
      dsSeries.flatMap(r => r.flags),
      divDiscFlags,
      metricOutliers.flatMap(r => r.flags),
      componentDecline,
      reclassification,
      payoutAnomaly
    )
  );

  // Terminal period flags
  const latestPeriod = periods[periods.length - 1].period_end;
  const terminalFlags = allFlagsFlat.filter(f => f.period === latestPeriod);

  // Add any terminal RE anchor flags
  terminalFlags.push(...reAnchorFlags);

  const contamination = computeContaminationTier(terminalFlags);

  return {
    dsSeries, divDiscFlags, metricOutliers, componentDecline,
    reclassification, payoutAnomaly, terminalFlags, contamination,
    periodSummaries, cumulativeDS, cumulativeDS_pct,
  };
}
