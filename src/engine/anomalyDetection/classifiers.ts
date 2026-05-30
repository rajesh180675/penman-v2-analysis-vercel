import { RecastPeriod, SpecFlag, Severity, ContaminationResult, ContaminationTier, EngineConfig } from "../types";
import { medianOf, flag } from "./shared";

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
  const RE_T    = reSeries[n - 1]!.RE;
  const RE_prev = n >= 2 ? reSeries[n - 2]!.RE : null;
  const reVals  = reSeries.map(r => r.RE).filter(Number.isFinite);
  const RE_median = medianOf(reVals);

  const anchor_jump        = RE_prev != null && Math.abs(RE_prev) > 1 ? Math.abs(RE_T / RE_prev) : null;
  const anchor_vs_median   = RE_median != null && Math.abs(RE_median) > 1 ? Math.abs(RE_T / RE_median) : null;

  const flags: SpecFlag[] = [];
  let terminal_anomaly = false;
  const latest_period  = reSeries[n - 1]!.period;

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
