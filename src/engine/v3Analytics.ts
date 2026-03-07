/**
 * Penman–Nissim V3 Analytics Engine
 *
 * Implements the V3 specification:
 *   §2.5  Data Validation Checks
 *   §6    Clean-Surplus Accounting and Dirty-Surplus Adjustment
 *   §9.1  Company-Specific Fade Parameter Estimation
 *   §9.2  Fade Target Computation
 *   §11   Terminal Value Anchoring, Normalization, and Guardrails
 *   §12.1 RE Sensitivity Matrix
 *   §12.2 Terminal Anchor Sensitivity Table
 *   §13   Event Detection and Flagging
 *   §14   Composite Confidence Scoring
 *
 * All monetary values: ₹ Crore (float64)
 * All ratios: dimensionless float64 (0.25 = 25%)
 */

import { RecastPeriod, EngineConfig } from "./types";

/* ══════════════════════════════════════════════════════════════════
   §2.5 Data Validation
══════════════════════════════════════════════════════════════════ */

export interface DataValidationResult {
  checks: Array<{
    id: string;
    description: string;
    period?: string;
    passed: boolean;
    severity: "ERROR" | "WARNING";
    detail?: string;
  }>;
  errors: number;
  warnings: number;
}

export function runDataValidation(periods: RecastPeriod[]): DataValidationResult {
  const checks: DataValidationResult["checks"] = [];

  // CHECK_5: Minimum periods
  if (periods.length < 5) {
    checks.push({
      id: "CHECK_5a",
      description: "Insufficient data — at least 5 periods required",
      passed: false,
      severity: "ERROR",
      detail: `Only ${periods.length} periods found`,
    });
  } else if (periods.length < 10) {
    checks.push({
      id: "CHECK_5b",
      description: "Fewer than 10 periods — company-specific fade parameter estimation disabled",
      passed: false,
      severity: "WARNING",
      detail: `${periods.length} periods found`,
    });
  } else {
    checks.push({
      id: "CHECK_5",
      description: "Minimum period count",
      passed: true,
      severity: "WARNING",
    });
  }

  // CHECK_3: Sign consistency
  for (const p of periods) {
    if (p.bs.TA <= 0) {
      checks.push({
        id: "CHECK_3",
        description: "Sign convention violation",
        period: p.period_end,
        passed: false,
        severity: "ERROR",
        detail: `Total assets = ${p.bs.TA}`,
      });
    }
    if (p.is.Sales <= 0) {
      checks.push({
        id: "CHECK_3b",
        description: "Revenue non-positive",
        period: p.period_end,
        passed: false,
        severity: "ERROR",
        detail: `Sales = ${p.is.Sales}`,
      });
    }
  }

  // CHECK_1: Balance sheet approximate balance
  for (const p of periods) {
    const TL = p.bs.TA - p.bs.CSE - p.bs.MI;
    const totalFinancing = p.bs.CSE + p.bs.MI + p.bs.FO + p.bs.OL;
    const gap = Math.abs(p.bs.TA - totalFinancing);
    if (p.bs.TA > 0 && gap / p.bs.TA > 0.05) {
      checks.push({
        id: "CHECK_1",
        description: "Balance sheet does not balance",
        period: p.period_end,
        passed: false,
        severity: "WARNING",
        detail: `Gap = ₹${gap.toFixed(0)} Cr (${((gap / p.bs.TA) * 100).toFixed(1)}% of TA)`,
      });
    }
  }

  // CHECK_4: Temporal consistency
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];
    if (prev.bs.TA > 0) {
      const taRatio = cur.bs.TA / prev.bs.TA;
      if (taRatio > 3.0 || taRatio < 0.33) {
        checks.push({
          id: "CHECK_4a",
          description: "Total assets changed by >3× YoY",
          period: cur.period_end,
          passed: false,
          severity: "WARNING",
          detail: `Ratio = ${taRatio.toFixed(2)}×`,
        });
      }
    }
    if (prev.is.Sales > 0) {
      const salesRatio = cur.is.Sales / prev.is.Sales;
      if (salesRatio > 2.5 || salesRatio < 0.4) {
        checks.push({
          id: "CHECK_4b",
          description: "Revenue changed by >2.5× YoY",
          period: cur.period_end,
          passed: false,
          severity: "WARNING",
          detail: `Ratio = ${salesRatio.toFixed(2)}×`,
        });
      }
    }
  }

  const errors = checks.filter((c) => !c.passed && c.severity === "ERROR").length;
  const warnings = checks.filter((c) => !c.passed && c.severity === "WARNING").length;
  return { checks, errors, warnings };
}

/* ══════════════════════════════════════════════════════════════════
   §6 Clean-Surplus Accounting and Dirty-Surplus Adjustment
══════════════════════════════════════════════════════════════════ */

export type DSSeverity = "NEGLIGIBLE" | "MINOR" | "MATERIAL" | "CRITICAL";

export interface DirtySurplusRecord {
  period_end: string;
  CSE_t: number;
  CSE_t1: number;
  CNI_t: number;
  d_reported_t: number;
  dirty_surplus: number;
  DS_pct_of_CSE: number;
  ds_class: DSSeverity;
  CSE_adj: number; // clean-surplus-adjusted CSE
  RE_adj: number | null; // RE using CSE_adj denominator
}

export interface DirtySurplusSummary {
  records: DirtySurplusRecord[];
  cumulative_dirty_surplus: number;
  cum_ds_pct: number;
  clean_surplus_compromised: boolean;
  CSE_adj_latest: number;
}

export function computeDirtySurplus(
  periods: RecastPeriod[],
  ke: number,
  materialThreshold = 0.10,
  compromisedThreshold = 0.20
): DirtySurplusSummary {
  const records: DirtySurplusRecord[] = [];
  let cumDS = 0;
  let CSE_adj = periods[0]?.bs.CSE ?? 0;

  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];

    const CNI_t = cur.is.CNI;
    const d_reported = cur.cf.DividendPaid; // positive = cash out
    const CSE_t = cur.bs.CSE;
    const CSE_t1 = prev.bs.CSE;

    // Dirty surplus: the OCI/reclass/capital-transaction residual
    // DS = ΔCSE - CNI + dividends_paid
    const dirty_surplus = (CSE_t - CSE_t1) - CNI_t + d_reported;
    cumDS += dirty_surplus;

    const DS_pct_of_CSE = CSE_t1 > 0 ? Math.abs(dirty_surplus) / CSE_t1 : 0;

    let ds_class: DSSeverity = "NEGLIGIBLE";
    if (DS_pct_of_CSE >= compromisedThreshold) ds_class = "CRITICAL";
    else if (DS_pct_of_CSE >= materialThreshold) ds_class = "MATERIAL";
    else if (DS_pct_of_CSE >= 0.02) ds_class = "MINOR";

    // Adjusted CSE: mechanically enforce clean surplus
    CSE_adj = CSE_adj + CNI_t - d_reported;

    const RE_adj = ke > 0 && i >= 1 ? CNI_t - ke * records[i - 1]?.CSE_adj ?? ke * CSE_t1 : null;

    records.push({
      period_end: cur.period_end,
      CSE_t,
      CSE_t1,
      CNI_t,
      d_reported_t: d_reported,
      dirty_surplus,
      DS_pct_of_CSE,
      ds_class,
      CSE_adj,
      RE_adj,
    });
  }

  const CSE_latest = periods[periods.length - 1]?.bs.CSE ?? 1;
  const cum_ds_pct = Math.abs(cumDS) / Math.max(CSE_latest, 1);
  const clean_surplus_compromised = cum_ds_pct > compromisedThreshold;

  return {
    records,
    cumulative_dirty_surplus: cumDS,
    cum_ds_pct,
    clean_surplus_compromised,
    CSE_adj_latest: CSE_adj,
  };
}

/* ══════════════════════════════════════════════════════════════════
   §13 Event Detection and Period Flags
══════════════════════════════════════════════════════════════════ */

export type EventFlag =
  | "STRUCTURAL_EVENT_CRITICAL"
  | "STRUCTURAL_EVENT"
  | "CAPITAL_TRANSACTION_LIKELY"
  | "PM_OUTLIER_CRITICAL"
  | "PM_OUTLIER_WARNING"
  | "LARGE_COMPONENT_DECLINE"
  | "PAYOUT_EXCEEDS_EARNINGS"
  | "IND_AS_116_TRANSITION"
  | "SMALL_NOA_DENOMINATOR"
  | "ROCE_OUTLIER_CRITICAL";

export interface PeriodEventFlags {
  period_end: string;
  flags: EventFlag[];
  noa_change_pct: number | null;
  pm_zscore: number | null;
  roce_zscore: number | null;
  ds_pct: number | null;
}

/** Compute rolling trailing-5y median and stddev at position i */
function trailingStats(
  values: (number | null | undefined)[],
  i: number,
  window = 5
): { median: number | null; stdev: number | null } {
  const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  if (slice.length < 2) return { median: null, stdev: null };
  const sorted = [...slice].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const stdev = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1));
  return { median: med, stdev };
}

export function detectPeriodEventFlags(
  periods: RecastPeriod[],
  dsSummary: DirtySurplusSummary,
  pmWarnZ = 1.5,
  pmCritZ = 2.5
): PeriodEventFlags[] {
  const pmValues = periods.map((p) => p.ratios?.PM ?? null);
  const roceValues = periods.map((p) => p.ratios?.ROCE ?? null);

  return periods.map((cur, i) => {
    const flags: EventFlag[] = [];
    const prev = i > 0 ? periods[i - 1] : null;

    // FLAG 1: Structural event (large ΔNOA)
    let noa_change_pct: number | null = null;
    if (prev && Math.abs(prev.bs.NOA) > 1) {
      noa_change_pct = (cur.bs.NOA - prev.bs.NOA) / Math.abs(prev.bs.NOA);
      if (Math.abs(noa_change_pct) > 0.50) flags.push("STRUCTURAL_EVENT_CRITICAL");
      else if (Math.abs(noa_change_pct) > 0.25) flags.push("STRUCTURAL_EVENT");
    }

    // FLAG 2: Capital transaction (from dirty surplus)
    const dsRec = dsSummary.records.find((r) => r.period_end === cur.period_end);
    const ds_pct = dsRec?.DS_pct_of_CSE ?? null;
    if (dsRec && (dsRec.ds_class === "MATERIAL" || dsRec.ds_class === "CRITICAL")) {
      flags.push("CAPITAL_TRANSACTION_LIKELY");
    }

    // FLAG 3: PM outlier (trailing z-score)
    let pm_zscore: number | null = null;
    if (i >= 2) {
      const { median: pm_med, stdev: pm_std } = trailingStats(pmValues, i - 1);
      const pm_cur = pmValues[i];
      if (pm_med != null && pm_std != null && pm_std > 0.001 && pm_cur != null) {
        pm_zscore = (pm_cur - pm_med) / pm_std;
        if (Math.abs(pm_zscore) > pmCritZ) flags.push("PM_OUTLIER_CRITICAL");
        else if (Math.abs(pm_zscore) > pmWarnZ) flags.push("PM_OUTLIER_WARNING");
      }
    }

    // FLAG 4: Large component decline
    if (prev && prev.ratios) {
      const pm_prev = prev.ratios.PM;
      const pm_cur = cur.ratios?.PM;
      const roce_prev = prev.ratios.ROCE;
      const roce_cur = cur.ratios?.ROCE;
      if (pm_prev != null && pm_prev > 0 && pm_cur != null && pm_cur / pm_prev < 0.80)
        flags.push("LARGE_COMPONENT_DECLINE");
      else if (roce_prev != null && roce_prev > 0 && roce_cur != null && roce_cur / roce_prev < 0.80)
        flags.push("LARGE_COMPONENT_DECLINE");
    }

    // FLAG 5: Payout anomaly
    const cni = cur.is.CNI;
    if (cni > 0 && cur.cf.DividendPaid > cni) flags.push("PAYOUT_EXCEEDS_EARNINGS");

    // FLAG 6: Ind AS 116 transition detection (FY2020)
    if (cur.period_end.startsWith("2020") && prev) {
      const prevLease = 0; // we don't track separately yet — approximate with FO change
      const foIncrease = cur.bs.FO - prev.bs.FO;
      const oaIncrease = cur.bs.OA - prev.bs.OA;
      if (foIncrease > 0.05 * prev.bs.TA && oaIncrease > 0.05 * prev.bs.TA) {
        flags.push("IND_AS_116_TRANSITION");
      }
    }

    // FLAG 7: Small NOA denominator
    if (cur.ratios?.noaSmall) flags.push("SMALL_NOA_DENOMINATOR");

    // ROCE outlier
    let roce_zscore: number | null = null;
    if (i >= 2) {
      const { median: roce_med, stdev: roce_std } = trailingStats(roceValues, i - 1);
      const roce_cur = roceValues[i];
      if (roce_med != null && roce_std != null && roce_std > 0.001 && roce_cur != null) {
        roce_zscore = (roce_cur - roce_med) / roce_std;
        if (Math.abs(roce_zscore) > pmCritZ) flags.push("ROCE_OUTLIER_CRITICAL");
      }
    }

    return { period_end: cur.period_end, flags, noa_change_pct, pm_zscore, roce_zscore, ds_pct };
  });
}

/* ══════════════════════════════════════════════════════════════════
   §11 Terminal Value Anchoring and Guardrails
══════════════════════════════════════════════════════════════════ */

export interface TerminalAnchorResult {
  RE_anchor_1: number; // as-reported latest
  RE_anchor_2: number | null; // prior + growth
  RE_anchor_3: number | null; // 3Y median
  ReOI_anchor_1: number;
  ReOI_anchor_2: number | null;
  ReOI_anchor_3: number | null;
  selected_RE_anchor: number;
  selected_ReOI_anchor: number;
  anchor_method: string;
  terminal_event_flags: EventFlag[];
  pm_outlier_flag: "OK" | "WARNING" | "CRITICAL";
  g_terminal: number;
  g_source: string;
}

export function selectTerminalAnchor(
  periods: RecastPeriod[],
  periodFlags: PeriodEventFlags[],
  ke: number,
  kw: number,
  gTerminalOverride?: number | null,
  gFloor = 0.02,
  gCap = 0.07
): TerminalAnchorResult {
  const n = periods.length;
  if (n < 2) throw new Error("Need at least 2 periods for terminal anchor");

  // Build RE and ReOI series from existing ri field
  const RE_series = periods.map((p) => p.ri?.RE ?? null);
  const ReOI_series = periods.map((p) => p.ri?.ReOI ?? null);

  // Anchor 1: as-reported
  const RE_anchor_1 = RE_series[n - 1] ?? 0;
  const ReOI_anchor_1 = ReOI_series[n - 1] ?? 0;

  // Compute terminal g
  let g_terminal: number;
  let g_source: string;
  if (gTerminalOverride != null && Number.isFinite(gTerminalOverride)) {
    g_terminal = gTerminalOverride;
    g_source = "user-specified";
  } else {
    // Use lower of CNI CAGR, Sales CAGR, BV CAGR
    const cni_cagr = computeCagr(
      periods[0].is.CNI, periods[n - 1].is.CNI, n - 1
    );
    const sales_cagr = computeCagr(
      periods[0].is.Sales, periods[n - 1].is.Sales, n - 1
    );
    const bv_cagr = computeCagr(
      periods[0].bs.CSE, periods[n - 1].bs.CSE, n - 1
    );
    const candidates = [cni_cagr, sales_cagr, bv_cagr].filter(
      (v): v is number => v != null && Number.isFinite(v) && v > -0.2
    );
    const raw_g = candidates.length > 0 ? Math.min(...candidates) : 0.04;
    g_terminal = Math.max(gFloor, Math.min(gCap, raw_g));
    g_source = `auto (min of CNI CAGR ${pctStr(cni_cagr)}, Sales CAGR ${pctStr(sales_cagr)}, BV CAGR ${pctStr(bv_cagr)}), capped [${pctStr(gFloor)}, ${pctStr(gCap)}]`;
  }
  // Hard safety: g must be below both ke and kw
  if (g_terminal >= ke) g_terminal = ke - 0.01;
  if (g_terminal >= kw) g_terminal = Math.min(g_terminal, kw - 0.01);

  // Anchor 2: prior + growth
  const RE_anchor_2 =
    RE_series[n - 2] != null ? (RE_series[n - 2]! * (1 + g_terminal)) : null;
  const ReOI_anchor_2 =
    ReOI_series[n - 2] != null ? (ReOI_series[n - 2]! * (1 + g_terminal)) : null;

  // Anchor 3: 3Y median
  const RE_last3 = RE_series.slice(-3).filter((v): v is number => v != null);
  const ReOI_last3 = ReOI_series.slice(-3).filter((v): v is number => v != null);
  const RE_anchor_3 = RE_last3.length >= 2 ? medianOf(RE_last3) : null;
  const ReOI_anchor_3 = ReOI_last3.length >= 2 ? medianOf(ReOI_last3) : null;

  // Terminal period event flags
  const lastFlags = periodFlags[n - 1]?.flags ?? [];
  const prevFlags = periodFlags[n - 2]?.flags ?? [];
  const terminal_event_flags = lastFlags;

  const pm_outlier_flag: "OK" | "WARNING" | "CRITICAL" = lastFlags.includes("PM_OUTLIER_CRITICAL")
    ? "CRITICAL"
    : lastFlags.includes("PM_OUTLIER_WARNING")
    ? "WARNING"
    : "OK";

  // Anchor selection logic (§11.5)
  let selected_RE_anchor: number;
  let selected_ReOI_anchor: number;
  let anchor_method: string;

  const isCriticallyContaminated =
    lastFlags.includes("PM_OUTLIER_CRITICAL") ||
    lastFlags.includes("CAPITAL_TRANSACTION_LIKELY");

  if (lastFlags.length === 0) {
    selected_RE_anchor = RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_1;
    anchor_method = "RE_T (as reported)";
  } else if (isCriticallyContaminated) {
    // Fall back to prior + growth
    selected_RE_anchor = RE_anchor_2 ?? RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_2 ?? ReOI_anchor_1;
    anchor_method = RE_anchor_2 != null ? "RE_(T-1) + growth" : "RE_T (fallback)";

    // If prior period is ALSO critically contaminated, use 3Y median
    if (prevFlags.includes("PM_OUTLIER_CRITICAL") && RE_anchor_3 != null) {
      selected_RE_anchor = RE_anchor_3;
      selected_ReOI_anchor = ReOI_anchor_3 ?? selected_ReOI_anchor;
      anchor_method = "3Y median RE";
    }
  } else {
    selected_RE_anchor = RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_1;
    anchor_method = "RE_T (as reported, with warnings)";
  }

  return {
    RE_anchor_1,
    RE_anchor_2,
    RE_anchor_3,
    ReOI_anchor_1,
    ReOI_anchor_2,
    ReOI_anchor_3,
    selected_RE_anchor,
    selected_ReOI_anchor,
    anchor_method,
    terminal_event_flags,
    pm_outlier_flag,
    g_terminal,
    g_source,
  };
}

/** §11.6 Terminal Value Share Classification */
export type TVGrade = "GRADE_A" | "GRADE_B" | "GRADE_C" | "GRADE_D";
export function classifyTVShare(
  V_RE_CV3: number,
  V_RE_CV1: number
): { tv_share: number | null; tv_grade: TVGrade; tv_label: string } {
  if (V_RE_CV3 === 0) return { tv_share: null, tv_grade: "GRADE_D", tv_label: "Indeterminate" };
  const tv_share = (V_RE_CV3 - V_RE_CV1) / V_RE_CV3;
  let tv_grade: TVGrade = "GRADE_D";
  let tv_label = "Speculative — primarily a capitalized-earnings estimate";
  if (tv_share < 0.30) { tv_grade = "GRADE_A"; tv_label = "Anchored — value dominated by book equity and explicit RE"; }
  else if (tv_share < 0.50) { tv_grade = "GRADE_B"; tv_label = "Moderate terminal dependence"; }
  else if (tv_share < 0.70) { tv_grade = "GRADE_C"; tv_label = "Terminal-dependent — sensitive to perpetuity assumptions"; }
  return { tv_share, tv_grade, tv_label };
}

/* ══════════════════════════════════════════════════════════════════
   §12 Sensitivity Matrix and Anchor Table
══════════════════════════════════════════════════════════════════ */

export interface SensMatrixEntry {
  ke: number;
  g: number;
  V_RE_CV3: number;
}

export function computeSensitivityMatrix(
  CSE0: number,
  sum_PV_RE: number, // already discounted at base ke; we must recompute at grid ke
  RE_stream: Array<{ RE: number; period: string }>,
  selected_RE_anchor: number,
  base_ke: number,
  base_g: number,
  T: number, // number of explicit years
  gFloor = 0.02
): SensMatrixEntry[] {
  // ke grid: [ke-4%, ke-3%, ke-2%, ke, ke+2%] — no values below 5%
  const ke_grid = Array.from(
    new Set([
      Math.max(base_ke - 0.04, 0.05),
      Math.max(base_ke - 0.03, 0.05),
      Math.max(base_ke - 0.02, 0.06),
      base_ke,
      base_ke + 0.02,
    ])
  ).sort((a, b) => a - b);

  // g grid: ascending, max 3 values, capped below ke
  const g_low = Math.max(base_g - 0.02, gFloor);
  const g_mid_raw = Math.floor(base_g * 100) / 100; // round down to nearest 1%
  const g_mid = g_mid_raw < base_g ? g_mid_raw : base_g - 0.01;
  const g_grid = Array.from(new Set([g_low, g_mid, base_g]))
    .filter((g) => g < base_ke)
    .sort((a, b) => a - b);

  const results: SensMatrixEntry[] = [];
  for (const ke_i of ke_grid) {
    // Recompute sum_PV_RE at this ke
    const sum_pv = RE_stream.reduce((s, r, idx) => s + r.RE / Math.pow(1 + ke_i, idx + 1), 0);

    for (const g_j of g_grid) {
      if (ke_i - g_j <= 0) continue; // Gordon formula undefined
      const CV3 = (selected_RE_anchor * (1 + g_j)) / (ke_i - g_j);
      const PV_CV3 = CV3 / Math.pow(1 + ke_i, T);
      const V = CSE0 + sum_pv + PV_CV3;
      results.push({ ke: ke_i, g: g_j, V_RE_CV3: V });
    }
  }
  return results;
}

export interface AnchorTableEntry {
  label: string;
  anchor: number;
  V_RE_CV3: number;
  tv_share: number | null;
}

export function computeAnchorTable(
  CSE0: number,
  sum_PV_RE: number,
  anchorResult: TerminalAnchorResult,
  ke: number,
  T: number
): AnchorTableEntry[] {
  const { g_terminal } = anchorResult;
  const rhoE = 1 + ke;

  const valFromAnchor = (anchor: number) => {
    if (ke - g_terminal <= 0) return CSE0 + sum_PV_RE;
    const CV3 = (anchor * (1 + g_terminal)) / (ke - g_terminal);
    const PV_CV3 = CV3 / Math.pow(rhoE, T);
    return CSE0 + sum_PV_RE + PV_CV3;
  };

  const V_CV1 = CSE0 + sum_PV_RE;

  const entries: AnchorTableEntry[] = [];
  const addEntry = (label: string, anchor: number | null) => {
    if (anchor == null) return;
    const V = valFromAnchor(anchor);
    entries.push({
      label,
      anchor,
      V_RE_CV3: V,
      tv_share: V !== 0 ? (V - V_CV1) / V : null,
    });
  };

  addEntry("RE_T (as reported)", anchorResult.RE_anchor_1);
  addEntry("RE_(T-1) + growth", anchorResult.RE_anchor_2);
  addEntry("3Y median RE", anchorResult.RE_anchor_3);

  return entries;
}

/* ══════════════════════════════════════════════════════════════════
   §14 Composite Confidence Score
══════════════════════════════════════════════════════════════════ */

export interface ConfidenceComponent {
  name: string;
  score: number; // 0–100
  weight: number;
  detail: string;
}

export interface ConfidenceResult {
  components: ConfidenceComponent[];
  composite: number; // 0–100
  classification: "HIGH" | "MODERATE" | "LOW" | "VERY_LOW";
  separation_score: number;
}

export function computeConfidenceScore(
  periods: RecastPeriod[],
  dsSummary: DirtySurplusSummary,
  anchorResult: TerminalAnchorResult,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  eq16_residual_latest: number | null
): ConfidenceResult {
  const n = periods.length;
  const latest = periods[n - 1];

  // C1: Separation confidence (from latest period separationScore)
  const C1 = Math.min(100, latest.bs.separationScore);
  const W1 = 20;

  // C2: Clean surplus integrity
  const C2 = Math.max(0, 100 - dsSummary.cum_ds_pct * 500);
  const W2 = 20;

  // C3: RE–ReOI convergence
  const identity_gap_pct =
    V_RE_CV3 !== 0 ? Math.abs(V_RE_CV3 - V_ReOI_CV03) / Math.abs(V_RE_CV3) : 1;
  const C3 = Math.max(0, 100 - identity_gap_pct * 500);
  const W3 = 15;

  // C4: Eq.16 bridge closure
  const eq16_residual_abs = eq16_residual_latest != null ? Math.abs(eq16_residual_latest) : 0.5;
  const C4 = Math.max(0, 100 - eq16_residual_abs * 400);
  const W4 = 15;

  // C5: Earnings persistence (CV of ROCE)
  const roce_vals = periods
    .map((p) => p.ratios?.ROCE)
    .filter((v): v is number => v != null && Number.isFinite(v));
  let C5 = 50;
  if (roce_vals.length >= 3) {
    const mean_roce = roce_vals.reduce((s, v) => s + v, 0) / roce_vals.length;
    const std_roce = Math.sqrt(
      roce_vals.reduce((s, v) => s + (v - mean_roce) ** 2, 0) / (roce_vals.length - 1)
    );
    const cv_roce = Math.abs(mean_roce) > 0.001 ? std_roce / Math.abs(mean_roce) : 1;
    C5 = Math.max(0, 100 - cv_roce * 200);
  }
  const W5 = 15;

  // C6: Terminal period cleanliness
  const n_terminal_flags = anchorResult.terminal_event_flags.length;
  const C6 = Math.max(0, 100 - n_terminal_flags * 25);
  const W6 = 15;

  const total_weight = W1 + W2 + W3 + W4 + W5 + W6;
  const composite =
    (C1 * W1 + C2 * W2 + C3 * W3 + C4 * W4 + C5 * W5 + C6 * W6) / total_weight;

  let classification: ConfidenceResult["classification"] = "VERY_LOW";
  if (composite >= 80) classification = "HIGH";
  else if (composite >= 60) classification = "MODERATE";
  else if (composite >= 40) classification = "LOW";

  return {
    components: [
      { name: "Separation Quality", score: C1, weight: W1, detail: `Separation score = ${C1.toFixed(0)}/100` },
      { name: "Clean Surplus Integrity", score: C2, weight: W2, detail: `Cumulative dirty surplus = ${(dsSummary.cum_ds_pct * 100).toFixed(1)}% of equity` },
      { name: "RE–ReOI Convergence", score: C3, weight: W3, detail: `Identity gap = ${(identity_gap_pct * 100).toFixed(1)}%` },
      { name: "Eq.16 Bridge Closure", score: C4, weight: W4, detail: `|Eq.16 residual| = ${(eq16_residual_abs * 100).toFixed(1)}%` },
      { name: "Earnings Persistence", score: C5, weight: W5, detail: `ROCE coefficient of variation` },
      { name: "Terminal Period Cleanliness", score: C6, weight: W6, detail: `${n_terminal_flags} terminal-period flag(s)` },
    ],
    composite,
    classification,
    separation_score: C1,
  };
}

/* ══════════════════════════════════════════════════════════════════
   §9.1 Company-Specific Fade Parameter Estimation
══════════════════════════════════════════════════════════════════ */

export interface FadeParamEstimate {
  driver: "PM" | "ATO" | "sales_growth";
  phi: number;
  alpha: number;
  r_squared: number;
  source: "COMPANY_SPECIFIC" | "NP_DEFAULT";
  target: number;
  target_source: string;
}

export function estimateFadeParams(
  periods: RecastPeriod[],
  npDefaultPM = 0.87,
  npDefaultATO = 0.95,
  npDefaultSalesGrowth = 0.70,
  targetPM = 0.055,
  targetATO = 1.18,
  targetSalesGrowth = 0.038,
  blendWeight = 0.5
): FadeParamEstimate[] {
  const results: FadeParamEstimate[] = [];

  const pmSeries = periods.map((p) => p.ratios?.PM ?? null);
  const atoSeries = periods.map((p) => p.ratios?.ATO ?? null);
  const salesGrowthSeries = periods.map((p) => p.ratios?.Sales_growth ?? null);

  const estimate = (
    driver: FadeParamEstimate["driver"],
    series: (number | null)[],
    npDefault: number,
    npTarget: number
  ): FadeParamEstimate => {
    const valid = series.filter((v): v is number => v != null && Number.isFinite(v));

    if (valid.length >= 10) {
      // OLS AR(1)
      const X = valid.slice(0, -1);
      const Y = valid.slice(1);
      const n = X.length;
      const meanX = X.reduce((s, v) => s + v, 0) / n;
      const meanY = Y.reduce((s, v) => s + v, 0) / n;
      const cov = X.reduce((s, v, i) => s + (v - meanX) * (Y[i] - meanY), 0) / n;
      const varX = X.reduce((s, v) => s + (v - meanX) ** 2, 0) / n;
      const phi = varX > 0 ? cov / varX : npDefault;
      const alpha = meanY - phi * meanX;

      // R²
      const ss_res = Y.reduce((s, y, i) => s + (y - (alpha + phi * X[i])) ** 2, 0);
      const ss_tot = Y.reduce((s, y) => s + (y - meanY) ** 2, 0);
      const r2 = ss_tot > 0 ? 1 - ss_res / ss_tot : 0;

      if (r2 > 0.30 && phi > 0.50 && phi < 0.98) {
        // Blended target: 50% N&P median + 50% company floor
        const company_floor = Math.min(...valid);
        const blended_target = blendWeight * npTarget + (1 - blendWeight) * company_floor;
        const final_target = Math.max(blended_target, npTarget);
        return {
          driver, phi, alpha, r_squared: r2,
          source: "COMPANY_SPECIFIC",
          target: final_target,
          target_source: `${(blendWeight * 100).toFixed(0)}% N&P (${(npTarget * 100).toFixed(1)}%) + ${((1 - blendWeight) * 100).toFixed(0)}% company floor (${(company_floor * 100).toFixed(1)}%)`,
        };
      }
    }

    return {
      driver, phi: npDefault, alpha: npTarget * (1 - npDefault), r_squared: 0,
      source: "NP_DEFAULT",
      target: npTarget,
      target_source: "N&P (2001) Table 3",
    };
  };

  results.push(estimate("PM", pmSeries, npDefaultPM, targetPM));
  results.push(estimate("ATO", atoSeries, npDefaultATO, targetATO));
  results.push(estimate("sales_growth", salesGrowthSeries, npDefaultSalesGrowth, targetSalesGrowth));

  return results;
}

/* ══════════════════════════════════════════════════════════════════
   §15 Auto-Generated Trigger Templates
══════════════════════════════════════════════════════════════════ */

export interface MonitoringTrigger {
  id: string;
  title: string;
  body: string;
}

export function generateMonitoringTriggers(
  periods: RecastPeriod[],
  companyId: string,
  ke: number
): MonitoringTrigger[] {
  const n = periods.length;
  const latest = periods[n - 1];
  const prev = n >= 2 ? periods[n - 2] : null;
  const triggers: MonitoringTrigger[] = [];

  // PM trigger
  const pm_vals = periods.map((p) => p.ratios?.PM ?? null).filter((v): v is number => v != null);
  if (pm_vals.length >= 3) {
    const pm_latest = pm_vals[pm_vals.length - 1];
    const pm_5y_min = Math.min(...pm_vals.slice(-5));
    const pm_hist_min = Math.min(...pm_vals);
    const threshold_warn = Math.max(pm_5y_min * 0.95, pm_latest * 0.85);
    triggers.push({
      id: "TRIGGER_PM",
      title: `${companyId} — PM path`,
      body: `PM is currently ${pctStr(pm_latest)}. If PM falls below ${pctStr(threshold_warn)}, re-underwrite with ke stress and steeper fade; below ${pctStr(pm_hist_min)}, valuation approaches lower sensitivity bounds.`,
    });
  }

  // Dividend sustainability trigger
  const div = latest.cf.DividendPaid;
  const fcf_cash = latest.cf.FCF_cash;
  const gap = div - fcf_cash;
  const fa = latest.bs.FA;
  if (gap > 0 && fa > 0) {
    const runway = fa / gap;
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId} — dividend sustainability`,
      body: `Dividend vs cash FCF gap is ₹${gap.toFixed(0)} Cr (FA runway ~${runway.toFixed(1)} years at current gap).`,
    });
  } else {
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId} — dividend sustainability`,
      body: `Cash FCF covers dividend with ₹${Math.abs(gap).toFixed(0)} Cr surplus.`,
    });
  }

  // RE momentum trigger
  const re_vals = periods.map((p) => p.ri?.RE ?? null).filter((v): v is number => v != null);
  if (re_vals.length >= 5) {
    const re_latest = re_vals[re_vals.length - 1];
    const re_prev_val = re_vals[re_vals.length - 2];
    const re_5y_median = medianOf(re_vals.slice(-5)) ?? re_latest;
    const re_floor = re_5y_median * 0.5;
    const re_growth_1y = re_prev_val !== 0 ? (re_latest - re_prev_val) / Math.abs(re_prev_val) : null;
    triggers.push({
      id: "TRIGGER_RE",
      title: `${companyId} — RE momentum`,
      body: `Monitor RE above ₹${re_floor.toFixed(0)} Cr. Latest RE: ₹${re_latest.toFixed(0)} Cr (${re_growth_1y != null ? `${(re_growth_1y >= 0 ? "+" : "")}${(re_growth_1y * 100).toFixed(1)}% YoY` : "—"}).`,
    });
  }

  // Spread compression trigger
  const spread_vals = periods.map((p) => p.ratios?.SPREAD ?? null).filter((v): v is number => v != null);
  if (spread_vals.length >= 3) {
    const spread_latest = spread_vals[spread_vals.length - 1];
    const spread_5y_min = Math.min(...spread_vals.slice(-5));
    triggers.push({
      id: "TRIGGER_SPREAD",
      title: `${companyId} — spread compression`,
      body: `Current spread ${pctStr(spread_latest)}, 5Y floor ${pctStr(spread_5y_min)}. Watch for NBC increase or RNOA decline.`,
    });
  }

  return triggers;
}

/* ══════════════════════════════════════════════════════════════════
   §5.9 Summary statistics helpers
══════════════════════════════════════════════════════════════════ */

export interface RatioSummary {
  latest: number | null;
  five_y_robust: number | null; // median for NOA-sensitive, mean for others
  five_y_label: string;
  np_median: number | null;
  full_series: (number | null)[];
  cagr_10y: number | null;
}

export function buildRatioSummary(
  periods: RecastPeriod[],
  extractor: (p: RecastPeriod) => number | null | undefined,
  useMedian = false
): RatioSummary {
  const series = periods.map((p) => extractor(p) ?? null);
  const valid = series.filter((v): v is number => v != null && Number.isFinite(v));
  const last5 = valid.slice(-5);
  const five_y_robust = last5.length > 0
    ? (useMedian ? medianOf(last5) : last5.reduce((s, v) => s + v, 0) / last5.length)
    : null;
  const cagr_10y = valid.length >= 10
    ? computeCagr(valid[valid.length - 10], valid[valid.length - 1], 9)
    : null;
  return {
    latest: valid[valid.length - 1] ?? null,
    five_y_robust,
    five_y_label: useMedian ? "5Y Robust (median)" : "5Y Avg",
    np_median: null,
    full_series: series,
    cagr_10y,
  };
}

/* ══════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════ */

function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

function computeCagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function pctStr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Full V3 analytics bundle — call once per analysis */
export interface V3AnalyticsBundle {
  validation: DataValidationResult;
  dirtySurplus: DirtySurplusSummary;
  periodFlags: PeriodEventFlags[];
  anchorResult: TerminalAnchorResult;
  confidence: ConfidenceResult;
  fadeParams: FadeParamEstimate[];
  triggers: MonitoringTrigger[];
}

export function computeV3Analytics(
  periods: RecastPeriod[],
  cfg: EngineConfig,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  gTerminalOverride?: number | null,
  kwDerived?: number
): V3AnalyticsBundle {
  // S-9.4: use explicit ke from config, fall back to rf+erp
  const ke = cfg.ke > 0 ? cfg.ke : (cfg.risk_free_rate + cfg.equity_risk_premium);
  const kw = kwDerived ?? (ke * 0.75); // Prefer derived kw; approximate if not supplied

  const validation = runDataValidation(periods);
  const dirtySurplus = computeDirtySurplus(periods, ke);
  const periodFlags = detectPeriodEventFlags(periods, dirtySurplus);

  const anchorResult = selectTerminalAnchor(periods, periodFlags, ke, kw, gTerminalOverride);

  // Get eq16 residual from latest period with ratios
  const eq16_residual_latest = (() => {
    for (let i = periods.length - 1; i >= 0; i--) {
      const r = periods[i].ratios;
      if (r?.ROCE_eq16_error != null) return r.ROCE_eq16_error;
    }
    return null;
  })();

  const confidence = computeConfidenceScore(
    periods, dirtySurplus, anchorResult, V_RE_CV3, V_ReOI_CV03, eq16_residual_latest
  );
  const fadeParams = estimateFadeParams(periods);
  const companyId = periods[0]?.period_end ? (cfg.ticker ?? "Company") : "Company";
  const triggers = generateMonitoringTriggers(periods, companyId, ke);

  return { validation, dirtySurplus, periodFlags, anchorResult, confidence, fadeParams, triggers };
}
