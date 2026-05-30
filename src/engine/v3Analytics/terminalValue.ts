/* ================================================================
   v3Analytics decomposition — §11 Terminal Value Anchoring and
   Guardrails cluster.

   Lifted verbatim from src/engine/v3Analytics.ts. Imports DOWN only:
   RecastPeriod from ../types/recast, event helpers from ./eventFraming,
   numeric helpers from ./mathUtils. No back-edge to the parent.
   v3Analytics.ts re-exports the public surface, leaving external
   import paths unchanged. Behaviour byte-for-byte identical.
================================================================ */

import type { RecastPeriod } from "../types/recast";
import {
  hasCriticalTerminalFlag,
  type EventFlag,
  type PeriodEventFlags,
} from "./eventFraming";
import { computeCagr, medianOf, pctStr } from "./mathUtils";

export interface TerminalAnchorResult {
  method: "RE_T" | "RE_T1_growth" | "3Y_median";
  label: string;
  RE_anchor_1: number; // as-reported latest
  RE_anchor_2: number | null; // prior + growth
  RE_anchor_3: number | null; // 3Y median
  ReOI_anchor_1: number;
  ReOI_anchor_2: number | null;
  ReOI_anchor_3: number | null;
  selected_RE_anchor: number;
  selected_ReOI_anchor: number;
  anchor_method: string;
  g_applied: number;
  CV3_value: number;
  V_total: number;
  TV_share: number | null;
  TV_grade: TVGrade;
  RE_value: number;
  reference_RE_T: number;
  reference_V: number;
  V_as_reported: number;
  TV_share_raw: number | null;
  TV_grade_raw: TVGrade;
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
  gTerminalOverride?: number | null | undefined,
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
      periods[0]!.is.CNI, periods[n - 1]!.is.CNI, n - 1
    );
    const sales_cagr = computeCagr(
      periods[0]!.is.Sales, periods[n - 1]!.is.Sales, n - 1
    );
    const bv_cagr = computeCagr(
      periods[0]!.bs.CSE, periods[n - 1]!.bs.CSE, n - 1
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
  // Anchor 3: 3Y median — use T-1, T-2, T-3 (exclude T to avoid contamination per S-14.1)
  const RE_last3 = RE_series.slice(-4, -1).filter((v): v is number => v != null);
  const ReOI_last3 = ReOI_series.slice(-4, -1).filter((v): v is number => v != null);
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
  // Anchor selection logic (S-14.1) — deterministic, based on hasCriticalTerminalFlag
  let selected_RE_anchor: number;
  let selected_ReOI_anchor: number;
  let anchor_method: string;
  let method: TerminalAnchorResult["method"];
  let label: string;
  // S-14.1: ANY CRITICAL flag that affects terminal triggers fallback
  const isCriticallyContaminated = hasCriticalTerminalFlag(lastFlags);
  const prevIsCriticallyContaminated = hasCriticalTerminalFlag(prevFlags);
  if (lastFlags.length === 0) {
    selected_RE_anchor = RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_1;
    anchor_method = "RE_T (as reported)";
    method = "RE_T";
    label = "RE_T (as reported)";
  } else if (isCriticallyContaminated) {
    // Fall back to prior + growth
    selected_RE_anchor = RE_anchor_2 ?? RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_2 ?? ReOI_anchor_1;
    anchor_method = RE_anchor_2 != null ? "RE_(T-1) + growth" : "RE_T (fallback)";
    method = RE_anchor_2 != null ? "RE_T1_growth" : "RE_T";
    label = RE_anchor_2 != null ? "RE_(T-1) + growth" : "RE_T (fallback)";
    // S-14.1: If T-1 is ALSO critically contaminated, use 3Y median
    if (prevIsCriticallyContaminated && RE_anchor_3 != null) {
      selected_RE_anchor = RE_anchor_3;
      selected_ReOI_anchor = ReOI_anchor_3 ?? selected_ReOI_anchor;
      anchor_method = "3Y median RE";
      method = "3Y_median";
      label = "3Y median RE";
    }
  } else {
    selected_RE_anchor = RE_anchor_1;
    selected_ReOI_anchor = ReOI_anchor_1;
    anchor_method = "RE_T (as reported, with warnings)";
    method = "RE_T";
    label = "RE_T (as reported)";
  }
  const T = Math.max(1, n - 1);
  const CSE0 = periods[0]?.bs.CSE ?? 0;
  const sumPVRE = periods.slice(1).reduce((acc, p, idx) => {
    const re = p.ri?.RE ?? 0;
    return acc + re / Math.pow(1 + ke, idx + 1);
  }, 0);
  const cvFromAnchor = (anchor: number) => (ke - g_terminal > 0 ? (anchor * (1 + g_terminal)) / (ke - g_terminal) : 0);
  const CV3_value = cvFromAnchor(selected_RE_anchor);
  const referenceCV3 = cvFromAnchor(RE_anchor_1);
  const V_total = CSE0 + sumPVRE + CV3_value / Math.pow(1 + ke, T);
  const V_as_reported = CSE0 + sumPVRE + referenceCV3 / Math.pow(1 + ke, T);
  const tvGuarded = classifyTVShare(V_total, CSE0 + sumPVRE);
  const tvRaw = classifyTVShare(V_as_reported, CSE0 + sumPVRE);
  return {
    method,
    label,
    RE_anchor_1,
    RE_anchor_2,
    RE_anchor_3,
    ReOI_anchor_1,
    ReOI_anchor_2,
    ReOI_anchor_3,
    selected_RE_anchor,
    selected_ReOI_anchor,
    anchor_method,
    g_applied: g_terminal,
    CV3_value,
    V_total,
    TV_share: tvGuarded.tv_share,
    TV_grade: tvGuarded.tv_grade,
    RE_value: selected_RE_anchor,
    reference_RE_T: RE_anchor_1,
    reference_V: V_as_reported,
    V_as_reported,
    TV_share_raw: tvRaw.tv_share,
    TV_grade_raw: tvRaw.tv_grade,
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
