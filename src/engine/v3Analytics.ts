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
import { RecastPeriod, EngineConfig, ke_from_config } from "./types";
import { trace } from "../lib/traceLogger";
import { deriveKwFromStructure } from "./PenmanNissimEngine";
import { computeMoatScore, MoatScoreResult } from "./moatScoring";
import { scoreCapitalAllocation, CapAllocScoreResult } from "./capitalAllocationScoring";
import { assessCyclicality, CyclicalityAssessment } from "./cyclicalityDetector";
import { detectStructuralBreaks, StructuralBreakAssessment } from "./structuralBreakDetector";
import { computeLossMakerValuation, LossMakerValuationResult } from "./lossMakerValuation";
import { computeEPV, EPVResult } from "./grahamDoddEPV";
import { computeIndustrialMultiples, RelativeValuationResult } from "./relativeValuation";
export enum OutputChannel {
  REPORT = "report",
  AUDIT = "audit",
}
export class ConsistencyViolation extends Error {}
export class CanonicalOutputRegistry {
  private values = new Map<string, unknown>();
  private sources = new Map<string, string>();
  register<T>(key: string, value: T, sourceSpec: string): T {
    if (this.values.has(key)) {
      const existing = this.values.get(key);
      if (typeof existing === "number" && typeof value === "number") {
        const denom = Math.max(Math.abs(existing), 1);
        const delta = Math.abs(existing - value) / denom;
        if (delta > 0.001) {
          throw new ConsistencyViolation(
            `Conflicting values for '${key}': ${existing} (from ${this.sources.get(key)}) vs ${value} (from ${sourceSpec})`
          );
        }
      } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new ConsistencyViolation(
          `Conflicting values for '${key}': ${JSON.stringify(existing)} (from ${this.sources.get(key)}) vs ${JSON.stringify(value)} (from ${sourceSpec})`
        );
      }
      return existing as T;
    }
    this.values.set(key, value);
    this.sources.set(key, sourceSpec);
    return value;
  }
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}
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
export interface DirtySurplusFramework {
  per_period: Record<string, number>;
  cumulative: number;
  by_category: {
    structural_events: number;
    accounting_transitions: number;
    steady_state: number;
  };
  pct_cse: number;
  steady_state_annual: number;
}
export interface TriggerCalibrationResult {
  pm_base: number;
  pm_base_source: string;
  pm_warning: number;
  pm_critical: number;
  rnoa_threshold: number;
  re_threshold: number;
  div_gap: number;
  fa_runway: number | null;
  consecutive_re_declines: number;
  re_peak: number | null;
  re_peak_year: number | null;
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
    const priorCSEAdj = records[i - 1]?.CSE_adj ?? CSE_t1;
    const RE_adj = ke > 0 ? CNI_t - ke * priorCSEAdj : null;
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
export function computeDirtySurplusFramework(
  periods: RecastPeriod[],
  periodFlags: PeriodEventFlags[],
  registry?: CanonicalOutputRegistry
): DirtySurplusFramework {
  const perPeriod: Record<string, number> = {};
  const by_category = {
    structural_events: 0,
    accounting_transitions: 0,
    steady_state: 0,
  };
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];
    const ds = (cur.bs.CSE - prev.bs.CSE) - cur.is.CNI + cur.cf.DividendPaid;
    perPeriod[cur.period_end] = ds;
    const flags = periodFlags.find((f) => f.period_end === cur.period_end)?.flags ?? [];
    if (flags.includes("STRUCTURAL_EVENT_CRITICAL")) by_category.structural_events += ds;
    else if (flags.includes("IND_AS_116_TRANSITION") || flags.includes("POTENTIAL_RECLASSIFICATION")) by_category.accounting_transitions += ds;
    else by_category.steady_state += ds;
  }
  const cumulative = Object.values(perPeriod).reduce((s, v) => s + v, 0);
  const cumulative_clean = Object.entries(perPeriod)
    .filter(([period]) => {
      const flags = periodFlags.find((f) => f.period_end === period)?.flags ?? [];
      return !flags.includes("STRUCTURAL_EVENT_CRITICAL");
    })
    .reduce((s, [, ds]) => s + ds, 0);
  const latestCSE = Math.max(Math.abs(periods[periods.length - 1]?.bs.CSE ?? 0), 1);
  const pct_cse = cumulative / latestCSE;
  const steady = Object.entries(perPeriod)
    .filter(([period]) => {
      const flags = periodFlags.find((f) => f.period_end === period)?.flags ?? [];
      return !hasCriticalTerminalFlag(flags);
    })
    .map(([, ds]) => ds);
  const steady_state_annual = steady.length
    ? steady.reduce((s, v) => s + v, 0) / steady.length
    : 0;
  registry?.register("DS_per_period", perPeriod, "S-15.4");
  registry?.register("DS_cumulative_all", cumulative, "S-15.4");
  registry?.register("DS_cumulative_clean", cumulative_clean, "S-15.4");
  registry?.register("DS_display", cumulative, "S-15.4");
  registry?.register("DS_display_label", "all periods, reported dividends", "S-15.4");
  registry?.register("DS_by_category", by_category, "S-15.4");
  registry?.register("DS_pct_CSE", pct_cse, "S-15.4");
  registry?.register("DS_steady_state_annual", steady_state_annual, "S-15.4");
  return {
    per_period: perPeriod,
    cumulative,
    by_category,
    pct_cse,
    steady_state_annual,
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
  | "ROCE_OUTLIER_CRITICAL"
  | "POTENTIAL_RECLASSIFICATION";
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
function hasCriticalTerminalFlag(flags: EventFlag[]): boolean {
  return flags.some((f) => [
    "STRUCTURAL_EVENT_CRITICAL",
    "PM_OUTLIER_CRITICAL",
    "ROCE_OUTLIER_CRITICAL",
  ].includes(f));
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
      const foIncrease = cur.bs.FO - prev.bs.FO;
      const oaIncrease = cur.bs.OA - prev.bs.OA;
      if (foIncrease > 0.05 * prev.bs.TA && oaIncrease > 0.05 * prev.bs.TA) {
        flags.push("IND_AS_116_TRANSITION");
      }
    }
    // FLAG 7: Small NOA denominator
    if (cur.ratios?.noaSmall) flags.push("SMALL_NOA_DENOMINATOR");
    // FLAG 8: Potential reclassification (large OA_Other residual without structural event)
    // Spec S-15.1: periods where ΔOther OA > 30% of ΔOA but no STRUCTURAL_EVENT_CRITICAL
    if (prev && !flags.includes("STRUCTURAL_EVENT_CRITICAL")) {
      const deltaOA = cur.bs.OA - prev.bs.OA;
      if (Math.abs(deltaOA) > 1) {
        const identifiedDelta =
          (cur.bs.OA_PPE - prev.bs.OA_PPE) +
          (cur.bs.OA_ROU - prev.bs.OA_ROU) +
          (cur.bs.OA_Inventory - prev.bs.OA_Inventory) +
          (cur.bs.OA_TradeReceivables - prev.bs.OA_TradeReceivables) +
          (cur.bs.OA_Goodwill - prev.bs.OA_Goodwill) +
          (cur.bs.OA_OtherIntangibles - prev.bs.OA_OtherIntangibles) +
          (cur.bs.OA_CWIP - prev.bs.OA_CWIP) +
          (cur.bs.OA_DTA - prev.bs.OA_DTA);
        const otherOA = deltaOA - identifiedDelta;
        if (Math.abs(otherOA / deltaOA) > 0.40) {
          flags.push("POTENTIAL_RECLASSIFICATION");
        }
      }
    }
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
  _sum_PV_RE: number, // already discounted at base ke; we must recompute at grid ke
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
  classification: "HIGH" | "MODERATE" | "LOW";
  tier_message: string;
  separation_score: number;
}
function inferContaminationTier(nCrit: number, nWarn: number): "CLEAN" | "CAUTION" | "GUARDED" | "COMPROMISED" {
  if (nCrit >= 2) return "COMPROMISED";
  if (nCrit >= 1) return "GUARDED";
  if (nWarn >= 1) return "CAUTION";
  return "CLEAN";
}
export function computeConfidenceScore(
  periods: RecastPeriod[],
  dsSummary: DirtySurplusSummary,
  anchorResult: TerminalAnchorResult,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  _eq16_residual_latest: number | null,
  registry?: CanonicalOutputRegistry
): ConfidenceResult {
  const n = periods.length;
  const latest = periods[n - 1];
  const dataScore = Math.min(100, latest.bs.separationScore);
  const nCrit = anchorResult.terminal_event_flags.filter((f) =>
    ["STRUCTURAL_EVENT_CRITICAL", "PM_OUTLIER_CRITICAL", "CAPITAL_TRANSACTION_LIKELY", "ROCE_OUTLIER_CRITICAL"].includes(f)
  ).length;
  const nWarn = anchorResult.terminal_event_flags.filter((f) => f.includes("WARNING") || f === "STRUCTURAL_EVENT").length;
  const terminalScore = Math.max(0, 100 - nCrit * 20 - nWarn * 8);
  let robustnessScore = 100;
  const tv = anchorResult.TV_share ?? 1;
  if (tv > 0.6) robustnessScore -= 40;
  else if (tv > 0.4) robustnessScore -= 25;
  else if (tv > 0.25) robustnessScore -= 10;
  const gap = V_RE_CV3 !== 0 ? Math.abs(V_RE_CV3 - V_ReOI_CV03) / Math.abs(V_RE_CV3) : 1;
  if (gap > 0.30) robustnessScore -= 30;
  else if (gap > 0.20) robustnessScore -= 20;
  else if (gap > 0.10) robustnessScore -= 10;
  const dsPct = Math.abs(dsSummary.cumulative_dirty_surplus) / Math.max(Math.abs(latest.bs.CSE), 1);
  if (dsPct > 0.20) robustnessScore -= 20;
  else if (dsPct > 0.10) robustnessScore -= 10;
  else if (dsPct > 0.05) robustnessScore -= 5;
  robustnessScore = Math.max(0, robustnessScore);
  let eqScore = 100;
  const latestAccrual = Math.abs(latest.ratios?.accrual_ratio_bs ?? 0);
  if (latestAccrual > 0.20) eqScore -= 25;
  else if (latestAccrual > 0.10) eqScore -= 15;
  if (latest.ratios?.accrual_regime === "QUALITY_ACCRUAL") eqScore -= 20;
  const cc = latest.ratios?.cash_conversion_ratio ?? 0;
  if (cc < 0.5) eqScore -= 20;
  else if (cc < 0.7) eqScore -= 10;
  if ((latest.quality?.beneish_mscore ?? -3) > -1.78) eqScore -= 30;
  eqScore = Math.max(0, eqScore);
  let healthScore = 100;
  const p = latest.quality?.piotroski_total ?? 0;
  if (p <= 3) healthScore -= 30;
  else if (p <= 5) healthScore -= 15;
  else if (p <= 6) healthScore -= 5;
  const z = latest.quality?.altman_zprime ?? 0;
  if (z < 1.81) healthScore -= 30;
  else if (z < 2.99) healthScore -= 10;
  healthScore = Math.max(0, healthScore);
  const composite = Math.round(
    0.20 * dataScore +
    0.25 * terminalScore +
    0.25 * robustnessScore +
    0.15 * eqScore +
    0.15 * healthScore
  );
  let classification: ConfidenceResult["classification"] = "LOW";
  if (composite >= 70) classification = "HIGH";
  else if (composite >= 50) classification = "MODERATE";
  const tier_message = classification === "HIGH"
    ? "Valuation has high analytical confidence."
    : classification === "MODERATE"
    ? "Valuation has moderate confidence; use sensitivity range over point estimate."
    : "Valuation has low analytical confidence; treat as indicative only.";
  const components: ConfidenceComponent[] = [
    { name: "Data quality", score: dataScore, weight: 20, detail: `Separation score = ${dataScore.toFixed(0)}/100` },
    { name: "Terminal integrity", score: terminalScore, weight: 25, detail: `${nCrit} critical and ${nWarn} warning terminal flags` },
    { name: "Valuation robustness", score: robustnessScore, weight: 25, detail: `TV share ${pctStr(tv)} | RE/ReOI gap ${pctStr(gap)} | DS ${pctStr(dsPct)}` },
    { name: "Earnings quality", score: eqScore, weight: 15, detail: `Accrual ${pctStr(latest.ratios?.accrual_ratio_bs)} | cash conversion ${numStr(cc)}` },
    { name: "Financial health", score: healthScore, weight: 15, detail: `Piotroski ${p}/9 | Altman Z' ${numStr(z)}` },
  ];
  const contaminationTier = inferContaminationTier(nCrit, nWarn);
  registry?.register("composite_confidence", composite, "S-14.3");
  registry?.register("composite_tier", classification, "S-14.3");
  registry?.register("composite_components", components, "S-14.3");
  registry?.register("composite_tier_message", tier_message, "S-14.3");
  registry?.register("terminal_flag_score", nCrit * 3 + nWarn, "S-14.3");
  registry?.register("contamination_tier", contaminationTier, "S-14.3");
  return {
    components,
    composite,
    classification,
    tier_message,
    separation_score: dataScore,
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
export function calibrateMonitoringTriggers(
  periods: RecastPeriod[],
  periodFlags: PeriodEventFlags[],
  registry?: CanonicalOutputRegistry,
  config?: EngineConfig
): TriggerCalibrationResult {
  const latest = periods[periods.length - 1];
  const cleanPeriod = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    const hasCritical = hasCriticalTerminalFlag(flags);
    const hasPmOutlier = flags.includes("PM_OUTLIER_CRITICAL") || flags.includes("PM_OUTLIER_WARNING");
    return !hasCritical && !hasPmOutlier && p.ratios?.PM != null;
  });
  const fallbackPms = periods
    .filter((p) => {
      const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
      return !hasCriticalTerminalFlag(flags) && p.ratios?.PM != null;
    })
    .map((p) => p.ratios?.PM as number);
  const pm_base = cleanPeriod?.ratios?.PM
    ?? (fallbackPms.length ? (medianOf(fallbackPms) ?? latest.ratios?.PM ?? 0) : latest.ratios?.PM ?? 0);
  const pm_base_source = cleanPeriod
    ? `${cleanPeriod.period_end.slice(0, 4)} (most recent clean period)`
    : "median of unflagged periods";
  const pm_warning = pm_base * 0.85;
  const pm_critical = pm_base * 0.7;
  const rnoaBase = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    return !hasCriticalTerminalFlag(flags) && !p.ratios?.noaSmall && p.ratios?.RNOA != null;
  })?.ratios?.RNOA ?? (medianOf(periods.map((p) => p.ratios?.RNOA ?? null).filter((v): v is number => v != null)) ?? 0);
  const ke = config?.ke ?? 0.13;
  const rnoa_threshold = Math.max(ke + 0.05, rnoaBase * 0.5);
  const reBase = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    return !hasCriticalTerminalFlag(flags) && p.ri?.RE != null;
  })?.ri?.RE ?? (medianOf(periods.map((p) => p.ri?.RE ?? null).filter((v): v is number => v != null)) ?? 0);
  const re_threshold = Math.max(ke * (latest.bs.CSE || 0) * 0.05, reBase * 0.5);
  const div_gap = latest.cf.DividendPaid - latest.cf.FCF_cash;
  const fa_runway = div_gap > 0 && latest.bs.FA > 0 ? latest.bs.FA / div_gap : null;
  const cleanREs = periods
    .filter((p) => {
      const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
      return !hasCriticalTerminalFlag(flags) && p.ri?.RE != null;
    })
    .map((p) => ({ period_end: p.period_end, RE: p.ri?.RE as number }));
  let consecutive_re_declines = 0;
  let streak = 0;
  let re_peak: number | null = null;
  let re_peak_year: number | null = null;
  for (let i = 1; i < cleanREs.length; i++) {
    if (cleanREs[i].RE < cleanREs[i - 1].RE) {
      streak += 1;
      consecutive_re_declines = Math.max(consecutive_re_declines, streak);
    } else streak = 0;
    if (re_peak == null || cleanREs[i].RE > re_peak) {
      re_peak = cleanREs[i].RE;
      re_peak_year = Number.parseInt(cleanREs[i].period_end.slice(0, 4), 10);
    }
  }
  registry?.register("pm_calibration_base", pm_base, "S-14.2");
  registry?.register("pm_calibration_source", pm_base_source, "S-14.2");
  registry?.register("pm_warning_threshold", pm_warning, "S-14.2");
  registry?.register("pm_critical_threshold", pm_critical, "S-14.2");
  registry?.register("rnoa_threshold", rnoa_threshold, "S-14.2");
  registry?.register("re_threshold", re_threshold, "S-14.2");
  return {
    pm_base,
    pm_base_source,
    pm_warning,
    pm_critical,
    rnoa_threshold,
    re_threshold,
    div_gap,
    fa_runway,
    consecutive_re_declines,
    re_peak,
    re_peak_year,
  };
}
export function generateMonitoringTriggers(
  periods: RecastPeriod[],
  companyId: string,
  ke: number,
  periodFlags: PeriodEventFlags[],
  _registry?: CanonicalOutputRegistry,
  config?: EngineConfig
): MonitoringTrigger[] {
  const latest = periods[periods.length - 1];
  // S-14.2: Do NOT pass registry here — calibrateMonitoringTriggers was already called
  // with registry in computeV3Analytics. Passing it again causes double registration.
  const c = calibrateMonitoringTriggers(periods, periodFlags, undefined, { ...(config ?? {}), ke } as EngineConfig);
  const triggers: MonitoringTrigger[] = [];
  triggers.push({
    id: "TRIGGER_PM",
    title: `${companyId}-specific trigger — PM path`,
    body: `PM is currently ${pctStr(latest.ratios?.PM)}. Calibration base: ${pctStr(c.pm_base)} (${c.pm_base_source}). If PM falls below ${pctStr(c.pm_warning)}, re-underwrite with ke stress and steeper fade; below ${pctStr(c.pm_critical)}, valuation approaches lower sensitivity bounds.`,
  });
  if (c.div_gap > 0 && c.fa_runway != null) {
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId}-specific trigger — dividend sustainability`,
      body: `Dividend vs cash FCF gap is ₹${c.div_gap.toFixed(0)} Cr (FA runway ~${c.fa_runway.toFixed(1)} years at current gap).`,
    });
  } else {
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId}-specific trigger — dividend sustainability`,
      body: `Cash FCF covers dividend with ₹${Math.abs(c.div_gap).toFixed(0)} Cr surplus.`,
    });
  }
  triggers.push({
    id: "TRIGGER_RNOA",
    title: `${companyId}-specific trigger — RNOA floor`,
    body: `RNOA warning threshold: ${pctStr(c.rnoa_threshold)} (calibrated to clean-period base).`,
  });
  triggers.push({
    id: "TRIGGER_RE",
    title: `${companyId}-specific trigger — RE trajectory`,
    body: `RE warning threshold: ₹${c.re_threshold.toFixed(0)} Cr. Clean-period decline streak: ${c.consecutive_re_declines}.`,
  });
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
export interface OADecompositionResult {
  period_end: string;
  components: {
    deltaPPE: number;
    deltaROU: number;
    deltaInventory: number;
    deltaReceivables: number;
    deltaGoodwill: number;
    deltaIntangibles: number;
    deltaCWIP: number;
    deltaDTA: number;
    deltaOtherOA: number;
  };
  interpretation?: string;
}
export interface ReReOIGapDecomposition {
  dirty_surplus: number;
  nfo_timing: number;
  tv_divergence: number;
  explicit_period_discounting: number;
  residual: number;
  total: number;
  dominant_driver: string;
}
export interface ShareCountResult {
  shares: number | null;
  source: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "FAILED";
  dilution_note?: string;
}
export interface MarketImpliedResult {
  status: "full" | "market_price_required" | "shares_unavailable";
  intrinsic_per_share?: number;
  shares?: number;
  shares_source?: string;
  market_cap?: number;
  market_price?: number;
  margin_of_safety?: number;
  implied_g?: number | null;
  implied_ke?: number | null;
  mos_interpretation?: string;
  implied_g_note?: string;
  implied_ke_note?: string;
  prompt?: string;
}
export interface VersionChangeEntry {
  spec_id: string;
  variable: string;
  old_value: number;
  new_value: number;
  delta_pct: number;
  reason: string;
  category: "bug_fix" | "methodology" | "data" | "config" | "unknown";
}
export function selectOADecompositionPeriods(periods: RecastPeriod[], periodFlags: PeriodEventFlags[]): string[] {
  const selected = new Set<string>();
  if (periods.length < 2) return [];
  // Rule 1: Largest absolute ΔNOA (always included)
  const maxShiftPeriod = periods.slice(1).map((p, idx) => ({
    period_end: p.period_end,
    deltaNOA: p.bs.NOA - periods[idx].bs.NOA,
  })).sort((a, b) => Math.abs(b.deltaNOA) - Math.abs(a.deltaNOA))[0];
  if (maxShiftPeriod) selected.add(maxShiftPeriod.period_end);
  for (const f of periodFlags) {
    // Rule 2: All STRUCTURAL_EVENT_CRITICAL periods
    // Rule 3: All POTENTIAL_RECLASSIFICATION periods (S-15.1)
    if (
      f.flags.includes("STRUCTURAL_EVENT_CRITICAL") ||
      f.flags.includes("IND_AS_116_TRANSITION") ||
      f.flags.includes("POTENTIAL_RECLASSIFICATION")
    ) {
      selected.add(f.period_end);
    }
  }
  // Rule 4: Terminal period always included (S-15.1)
  selected.add(periods[periods.length - 1].period_end);
  return [...selected].sort();
}
export function renderOADecomposition(period: RecastPeriod, prior: RecastPeriod): OADecompositionResult {
  const deltaPPE = period.bs.OA_PPE - prior.bs.OA_PPE;
  const deltaROU = period.bs.OA_ROU - prior.bs.OA_ROU;
  const deltaInventory = period.bs.OA_Inventory - prior.bs.OA_Inventory;
  const deltaReceivables = period.bs.OA_TradeReceivables - prior.bs.OA_TradeReceivables;
  const deltaGoodwill = period.bs.OA_Goodwill - prior.bs.OA_Goodwill;
  const deltaIntangibles = period.bs.OA_OtherIntangibles - prior.bs.OA_OtherIntangibles;
  const deltaCWIP = period.bs.OA_CWIP - prior.bs.OA_CWIP;
  const deltaDTA = period.bs.OA_DTA - prior.bs.OA_DTA;
  const identified = deltaPPE + deltaROU + deltaInventory + deltaReceivables + deltaGoodwill + deltaIntangibles + deltaCWIP + deltaDTA;
  const deltaOtherOA = (period.bs.OA - prior.bs.OA) - identified;
  let interpretation: string | undefined;
  const totalDeltaOA = period.bs.OA - prior.bs.OA;
  if (Math.abs(totalDeltaOA) > 1) {
    const otherPct = deltaOtherOA / totalDeltaOA;
    if (Math.abs(otherPct) > 0.4) {
      interpretation = `ΔOther OA accounts for ${(otherPct * 100).toFixed(0)}% of ΔOA; likely residual unmapped operating components.`;
    }
  }
  return {
    period_end: period.period_end,
    components: { deltaPPE, deltaROU, deltaInventory, deltaReceivables, deltaGoodwill, deltaIntangibles, deltaCWIP, deltaDTA, deltaOtherOA },
    interpretation,
  };
}
export function decomposeReReOIGap(
  periods: RecastPeriod[],
  valuation: { V_RE_CV3: number; V_ReOI_CV03: number; CSE0: number; pvRE: number; CV_RE: number; CV_ReOI: number; ke: number; kw: number },
  gEffective: number,
  registry?: CanonicalOutputRegistry,
): ReReOIGapDecomposition {
  const T = Math.max(1, periods.length - 1);
  const ke = valuation.ke;
  const kw = valuation.kw;
  const dirty_surplus = periods.slice(1).reduce((acc, p, idx) => {
    const prev = periods[idx];
    const ds = (p.bs.CSE - prev.bs.CSE) - p.is.CNI + p.cf.DividendPaid;
    return acc + ds / Math.pow(1 + ke, idx + 1);
  }, 0);
  const nfo_timing = periods.slice(1).reduce((acc, period, idx) => {
    const prev = periods[idx];
    const deltaNfo = (period.bs.NFO ?? 0) - (prev.bs.NFO ?? 0);
    return acc + deltaNfo / Math.pow(1 + ke, idx + 1);
  }, 0);
  const reT = periods[periods.length - 1]?.ri?.RE ?? 0;
  const reoiT = periods[periods.length - 1]?.ri?.ReOI ?? 0;
  const pvReTV = (ke > gEffective) ? (reT * (1 + gEffective) / (ke - gEffective)) / Math.pow(1 + ke, T) : 0;
  const pvReOITV = (kw > gEffective) ? (reoiT * (1 + gEffective) / (kw - gEffective)) / Math.pow(1 + kw, T) : 0;
  const tv_divergence = pvReTV - pvReOITV;
  const explicit_period_discounting = periods.slice(1).reduce((acc, p, idx) => {
    const t = idx + 1;
    return acc + (p.ri?.RE ?? 0) / Math.pow(1 + ke, t) - (p.ri?.ReOI ?? 0) / Math.pow(1 + kw, t);
  }, 0);
  const total = valuation.V_RE_CV3 - valuation.V_ReOI_CV03;
  const residual = total - dirty_surplus - nfo_timing - tv_divergence - explicit_period_discounting;
  const dominant_driver = Object.entries({ dirty_surplus, nfo_timing, tv_divergence, explicit_period_discounting })
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? "none";
  const out: ReReOIGapDecomposition = { dirty_surplus, nfo_timing, tv_divergence, explicit_period_discounting, residual, total, dominant_driver };
  registry?.register("re_reoi_gap", Math.abs(total), "S-15.2");
  registry?.register("re_reoi_gap_pct", valuation.V_RE_CV3 !== 0 ? Math.abs(total) / Math.abs(valuation.V_RE_CV3) : 0, "S-15.2");
  registry?.register("re_reoi_gap_decomposition", out, "S-15.2");
  return out;
}
export function deriveShareCount(
  periods: RecastPeriod[],
  registry?: CanonicalOutputRegistry,
  fallbackVPrimary?: number,
): ShareCountResult {
  const latest = periods[periods.length - 1];
  const directLatestShares = latest.shareCountInput?.endPeriodShares ?? null;
  const weightedAverageShares = latest.shareCountInput?.weightedAverageBasicShares ?? null;
  const shareHistory = periods
    .map((period) => period.shareCountInput?.endPeriodShares ?? period.shareCountInput?.weightedAverageBasicShares ?? null)
    .filter((value): value is number => value != null && value > 0 && Number.isFinite(value));
  const shareExpansion = shareHistory.slice(-5).reduce((sum, shares, idx, arr) => {
    if (idx === 0) return sum;
    return sum + Math.max(0, shares - arr[idx - 1]);
  }, 0);
  const dilutionBase = periods.slice(Math.max(1, periods.length - 5)).reduce((sum, p, idx) => {
    const prev = periods[Math.max(0, periods.length - 5) + idx - 1];
    if (!prev) return sum;
    return sum + Math.max(0, p.bs.CSE - prev.bs.CSE);
  }, 0);
  const buildShareDilutionNote = (basis: "direct" | "weighted_average" | "proxy", anchor: number) => {
    if (basis === "proxy") {
      return dilutionBase > 0.02 * Math.abs(anchor)
        ? `Recent 5Y equity expansion proxy: ₹${dilutionBase.toFixed(0)} Cr; per-share value may be diluted.`
        : "Minimal recent equity expansion proxy.";
    }
    if (shareHistory.length < 2) {
      return basis === "weighted_average"
        ? "Using weighted average basic shares because a period-end share count was not resolved."
        : "Using audited period-end shares from the input capital schedule.";
    }
    return shareExpansion > 0.02 * Math.abs(shareHistory[shareHistory.length - 1] ?? anchor)
      ? `Recent 5Y share-count expansion: ${shareExpansion.toFixed(2)} Cr shares; per-share value may be diluted.`
      : "Minimal recent share-count expansion over the last 5Y.";
  };

  if (directLatestShares && directLatestShares > 0) {
    const source = latest.shareCountInput?.endPeriodSharesSource || "Audited period-end share count";
    const confidence: ShareCountResult["confidence"] = /share capital/i.test(source) ? "MEDIUM" : "HIGH";
    const dilution_note = buildShareDilutionNote("direct", directLatestShares);
    registry?.register("shares_outstanding", directLatestShares, "S-16.1");
    registry?.register("shares_source", source, "S-16.1");
    registry?.register("shares_confidence", confidence, "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    return { shares: directLatestShares, source, confidence, dilution_note };
  }

  if (weightedAverageShares && weightedAverageShares > 0) {
    const source = latest.shareCountInput?.weightedAverageBasicSource || "Weighted average basic shares";
    const dilution_note = buildShareDilutionNote("weighted_average", weightedAverageShares);
    registry?.register("shares_outstanding", weightedAverageShares, "S-16.1");
    registry?.register("shares_source", source, "S-16.1");
    registry?.register("shares_confidence", "MEDIUM", "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    return { shares: weightedAverageShares, source, confidence: "MEDIUM", dilution_note };
  }

  const equity = latest.bs.CSE;
  const faceCandidates = [1, 2, 5, 10];
  const plausible = faceCandidates
    .map((fv) => ({ fv, shares: equity / fv }))
    .filter((x) => x.shares > 0 && Number.isFinite(x.shares));
  if (!plausible.length) {
    return { shares: null, source: "Share Capital not available in canonical input", confidence: "FAILED" };
  }
  let selected = plausible.find((x) => x.fv === 1) ?? plausible[0];
  let confidence: ShareCountResult["confidence"] = "LOW";
  if (fallbackVPrimary && fallbackVPrimary > 0) {
    const withSanity = plausible.filter((x) => {
      const perShare = fallbackVPrimary / x.shares;
      return perShare > 1 && perShare < 100000;
    });
    if (withSanity.length === 1) {
      selected = withSanity[0];
      confidence = "MEDIUM";
    } else if (withSanity.length > 1) {
      selected = withSanity.find((x) => x.fv === 1 || x.fv === 10) ?? withSanity[0];
      confidence = "LOW";
    }
  }
  const dilution_note = buildShareDilutionNote("proxy", equity);
  const source = `Equity proxy ₹${equity.toFixed(0)} Cr ÷ inferred face value ₹${selected.fv}`;
  registry?.register("shares_outstanding", selected.shares, "S-16.1");
  registry?.register("shares_source", source, "S-16.1");
  registry?.register("shares_confidence", confidence, "S-16.1");
  registry?.register("dilution_note", dilution_note, "S-16.1");
  return { shares: selected.shares, source, confidence, dilution_note };
}
export function computeMarketImplied(
  registry: CanonicalOutputRegistry,
  valuation: { V_primary: number; ke: number; g_effective: number; CSE0: number; pvRE: number; explicit_periods: number; RE_anchor: number; periods: RecastPeriod[] },
  marketPrice?: number,
  sharesOverride?: number,
): MarketImpliedResult {
  const shares = sharesOverride ?? registry.get<number>("shares_outstanding");
  const sharesSource = registry.get<string>("shares_source") ?? "registry";
  if (!shares || shares <= 0) return { status: "shares_unavailable" };
  const intrinsic_per_share = valuation.V_primary / shares;
  if (marketPrice == null || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    return {
      status: "market_price_required",
      intrinsic_per_share,
      shares,
      shares_source: sharesSource,
      prompt: `Intrinsic value per share is ₹${intrinsic_per_share.toFixed(1)}. Enter market price for implied analytics.`,
    };
  }
  const market_cap = marketPrice * shares;
  const margin_of_safety = (intrinsic_per_share - marketPrice) / marketPrice;
  const mos_interpretation = margin_of_safety > 0.2
    ? "Substantial margin of safety."
    : margin_of_safety > 0
    ? "Modest margin of safety."
    : margin_of_safety > -0.3
    ? "Market price exceeds intrinsic estimate."
    : "Market embeds expectations above current RE model trajectory.";
  const vAtG = (g: number) => {
    if (g >= valuation.ke - 0.001) return Number.POSITIVE_INFINITY;
    const cv = valuation.RE_anchor * (1 + g) / (valuation.ke - g);
    return valuation.CSE0 + valuation.pvRE + cv / Math.pow(1 + valuation.ke, valuation.explicit_periods);
  };
  let implied_g: number | null = null;
  let gNote = "";
  let lo = -0.10;
  let hi = valuation.ke - 0.005;
  if (vAtG(hi) >= market_cap && vAtG(lo) <= market_cap) {
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const vm = vAtG(mid);
      if (Math.abs(vm - market_cap) / Math.max(market_cap, 1) < 0.001) {
        implied_g = mid;
        break;
      }
      if (vm < market_cap) lo = mid;
      else hi = mid;
      implied_g = mid;
    }
    gNote = `Implied terminal RE growth at current ke is ${((implied_g ?? 0) * 100).toFixed(2)}%.`;
  } else {
    gNote = "No plausible g in bounded search range reconciles to market cap.";
  }
  const vAtKe = (keTry: number) => {
    const g = valuation.g_effective;
    if (keTry <= g + 0.001) return Number.POSITIVE_INFINITY;
    const pvRE = valuation.periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + keTry, idx + 1), 0);
    const cv = valuation.RE_anchor * (1 + g) / (keTry - g);
    return valuation.CSE0 + pvRE + cv / Math.pow(1 + keTry, valuation.explicit_periods);
  };
  let implied_ke: number | null = null;
  let keNote = "";
  let keLo = valuation.g_effective + 0.005;
  let keHi = 0.25;
  if (vAtKe(keLo) >= market_cap) {
    for (let i = 0; i < 100; i++) {
      const mid = (keLo + keHi) / 2;
      const vm = vAtKe(mid);
      if (Math.abs(vm - market_cap) / Math.max(market_cap, 1) < 0.001) {
        implied_ke = mid;
        break;
      }
      if (vm > market_cap) keLo = mid;
      else keHi = mid;
      implied_ke = mid;
    }
    keNote = `Implied ke at fixed g is ${((implied_ke ?? 0) * 100).toFixed(2)}%.`;
  } else {
    keNote = `Market cap exceeds model value even at low ke (${(keLo*100).toFixed(1)}%).`;
  }
  registry.register("market_intrinsic_per_share", intrinsic_per_share, "S-16.2");
  registry.register("market_cap", market_cap, "S-16.2");
  registry.register("market_price", marketPrice, "S-16.2");
  registry.register("market_margin_of_safety", margin_of_safety, "S-16.2");
  if (implied_g != null) registry.register("market_implied_g", implied_g, "S-16.2");
  if (implied_ke != null) registry.register("market_implied_ke", implied_ke, "S-16.2");
  return {
    status: "full",
    intrinsic_per_share,
    shares,
    shares_source: sharesSource,
    market_cap,
    market_price: marketPrice,
    margin_of_safety,
    implied_g,
    implied_ke,
    mos_interpretation,
    implied_g_note: gNote,
    implied_ke_note: keNote,
  };
}
export function compareWithPriorRegistry(
  currentRegistry: CanonicalOutputRegistry,
  priorSnapshot?: Record<string, unknown>,
): VersionChangeEntry[] {
  if (!priorSnapshot) return [];
  const tracked: Array<[string, string]> = [
    ["V_RE_CV3_reported", "RE CV3 (as-reported)"],
    ["V_primary", "Primary valuation"],
    ["g_effective", "Effective terminal growth"],
    ["kw_derived_latest", "kw (derived, latest)"],
    ["kw_derived_median", "kw (derived, median)"],
    ["DS_cumulative_all", "Cumulative dirty surplus"],
    ["eq16_residual_latest_pp", "Eq.16 residual (latest, pp)"],
    ["re_reoi_gap_pct", "RE/ReOI identity gap (%)"],
    ["tv_share_primary", "TV share (primary anchor)"],
    ["composite_confidence", "Composite confidence score"],
  ];
  const changes: VersionChangeEntry[] = [];
  for (const [key, label] of tracked) {
    const oldV = priorSnapshot[key];
    const newV = currentRegistry.get<number>(key);
    if (typeof oldV === "number" && typeof newV === "number") {
      const delta = Math.abs(oldV) > 0.001 ? (newV - oldV) / Math.abs(oldV) : (newV === oldV ? 0 : Number.POSITIVE_INFINITY);
      if (Math.abs(delta) > 0.01) {
        changes.push({ spec_id: "S-13.4", variable: label, old_value: oldV, new_value: newV, delta_pct: delta, reason: "[REQUIRES EXPLANATION]", category: "unknown" });
      }
    }
  }
  return changes;
}
export function renderVersionChangeLog(changes: VersionChangeEntry[]): string {
  if (!changes.length) return "";
  const header = `2.6A) Methodology Changes from Prior Version\n\nVariable | Prior | Current | Δ | Reason | Category\n---|---:|---:|---:|---|---\n`;
  return header + changes.map((c) => `${c.variable} | ${c.old_value.toFixed(4)} | ${c.new_value.toFixed(4)} | ${(c.delta_pct * 100).toFixed(1)}% | ${c.reason} | ${c.category}`).join("\n");
}
export interface CrossSectionRenderedBundle {
  header: string;
  section1: string;
  section5?: string;
  section6?: string;
  section6A?: string;
  section7?: string;
  section6A1RowCount?: number;
  /** For assertion 9: per-ke row with g values ascending and corresponding valuations */
  sensitivity?: Array<{ ke: number; values: number[]; g: number[] }>;
}
function parseFirstNumber(text: string): number | null {
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}
function extractAfterToken(text: string, token: string): number | null {
  const idx = text.toLowerCase().indexOf(token.toLowerCase());
  if (idx < 0) return null;
  return parseFirstNumber(text.slice(idx + token.length));
}
export function runCrossSectionAssertions(registry: CanonicalOutputRegistry, rendered: CrossSectionRenderedBundle): string[] {
  const issues: string[] = [];

  // ASSERTION 1: §1 terminal anchor label matches primary
  const anchor = registry.get<string>("primary_anchor_label");
  if (anchor && !rendered.section1.includes(anchor)) issues.push(`§1 anchor mismatch: expected '${anchor}'.`);

  // ASSERTION 2: §1 TV grade matches primary (guarded) grade
  const tvGrade = registry.get<string>("tv_grade");
  if (tvGrade && rendered.section1.includes("GRADE_") && !rendered.section1.includes(tvGrade)) issues.push(`§1 TV grade mismatch: expected '${tvGrade}'.`);

  // ASSERTION 3: Header V matches registry V_primary
  const vPrimaryHeader = registry.get<number>("V_primary");
  const headerV = parseFirstNumber(rendered.header);
  if (vPrimaryHeader != null && headerV != null) {
    const rel = Math.abs(headerV - vPrimaryHeader) / Math.max(Math.abs(vPrimaryHeader), 1);
    if (rel > 0.001) issues.push(`Header V mismatch: header=${headerV}, registry=${vPrimaryHeader}.`);
  }

  // ASSERTION 4: §1 g_effective matches registry
  const g = registry.get<number>("g_effective");
  if (g != null) {
    const pctToken = `${(g * 100).toFixed(1)}%`;
    if (rendered.section1.includes("g =") && !rendered.section1.includes(pctToken)) issues.push("§1 g mention inconsistent with registry.g_effective.");
  }

  // ASSERTION 5: §7 PM warning threshold matches registry
  const pmWarn = registry.get<number>("pm_warning_threshold");
  if (pmWarn != null && rendered.section7 && rendered.section7.includes("falls below")) {
    const token = `${Math.round(pmWarn * 100)}%`;
    if (!rendered.section7.includes(token)) issues.push("§7 PM warning threshold inconsistent with registry.");
  }

  // ASSERTION 6: §1 DS figure matches §5 DS figure (S-13.3)
  const dsAll = registry.get<number>("DS_cumulative_all");
  if (dsAll != null && rendered.section5 && rendered.section1) {
    const ds1 = extractAfterToken(rendered.section1, "dirty");
    const ds5 = extractAfterToken(rendered.section5, "dirty");
    if (ds1 != null && ds5 != null) {
      const rel = Math.abs(ds1 - ds5) / Math.max(Math.abs(ds1), 1);
      if (rel > 0.01) issues.push(`§1 DS=${ds1} differs from §5 DS=${ds5}.`);
    }
  }

  // ASSERTION 7: Company ID in trigger labels matches header company ID
  const companyId = registry.get<string>("company_id");
  if (companyId && rendered.section7) {
    const labels = Array.from(rendered.section7.matchAll(/([A-Za-z0-9_.-]+)-specific trigger/g)).map((m) => m[1]);
    for (const label of labels) {
      if (label !== companyId) issues.push(`§7 trigger label '${label}-specific' does not match company_id '${companyId}'.`);
    }
  }

  // ASSERTION 8: §6A.1 RE row count = periods - 1
  const nPeriods = registry.get<number>("period_count");
  if (nPeriods && rendered.section6A1RowCount != null && rendered.section6A1RowCount !== Math.max(0, nPeriods - 1)) {
    issues.push(`§6A.1 row count mismatch: got ${rendered.section6A1RowCount}, expected ${nPeriods - 1}.`);
  }

  // ASSERTION 9: Sensitivity matrix monotonicity (S-13.3)
  if (rendered.sensitivity && rendered.sensitivity.length > 0) {
    for (const row of rendered.sensitivity) {
      for (let i = 0; i < row.values.length - 1; i++) {
        if (row.values[i] > row.values[i + 1] + 0.01) {
          issues.push(`Sensitivity matrix non-monotonic at ke=${(row.ke * 100).toFixed(1)}%: V(g[${i}])=${row.values[i].toFixed(0)} > V(g[${i+1}])=${row.values[i + 1].toFixed(0)}.`);
        }
      }
    }
    const colCount = rendered.sensitivity[0].values.length;
    const rowsByKe = [...rendered.sensitivity].sort((a, b) => a.ke - b.ke);
    for (let c = 0; c < colCount; c++) {
      for (let i = 0; i < rowsByKe.length - 1; i++) {
        if (rowsByKe[i].values[c] < rowsByKe[i + 1].values[c] - 0.01) {
          issues.push(`Sensitivity matrix not decreasing in ke for g-column ${c}.`);
          break;
        }
      }
    }
  }

  // ASSERTION 10: If contamination is GUARDED/COMPROMISED, V_primary ≠ V_RE_CV3_reported (S-13.3)
  const vPrimary = registry.get<number>("V_primary");
  const vReported = registry.get<number>("V_RE_CV3_reported");
  const contaminationTier = registry.get<string>("contamination_tier");
  const anchorLabel = registry.get<string>("primary_anchor_label");
  if (
    vPrimary != null && vReported != null &&
    (contaminationTier === "GUARDED" || contaminationTier === "COMPROMISED" || (
      anchorLabel != null && anchorLabel !== "RE_T (as reported)" && anchorLabel !== "RE_T (as reported, with warnings)"
    ))
  ) {
    if (Math.abs(vPrimary - vReported) < 1) {
      issues.push(`V_primary equals V_RE_CV3_reported despite contamination guard (tier='${contaminationTier ?? "N/A"}', anchor='${anchorLabel ?? "N/A"}').`);
    }
  }

  return issues;
}
export const AUDIT_MARKERS: RegExp[] = [
  /V\d+ §\d+/g,
  /✓|✗/g,
  /\bintact\b/gi,
  /COMPLIANCE_CHECK/g,
  /__debug__/g,
];
export function firewallCheck(renderedText: string, auditLog: string[] = []): string[] {
  const violations: string[] = [];
  for (const pattern of AUDIT_MARKERS) {
    const matches = renderedText.match(pattern);
    if (matches?.length) {
      violations.push(`Audit marker '${pattern.source}' found in rendered output: ${matches.slice(0, 3).join(', ')}`);
    }
  }
  for (const entry of auditLog) {
    const chunks = entry.split(/[.;]/).map((x) => x.trim()).filter((x) => x.length >= 20);
    for (const chunk of chunks) {
      if (renderedText.includes(chunk)) {
        violations.push(`Audit log content leaked: '${chunk.slice(0, 50)}...'`);
      }
    }
  }
  return violations;
}
export function enforceMetadataFirewall(renderedText: string, auditLog: string[] = []): { rendered: string; violations: string[] } {
  const violations = firewallCheck(renderedText, auditLog);
  if (!violations.length) return { rendered: renderedText, violations };
  let sanitized = renderedText;
  for (const pattern of AUDIT_MARKERS) {
    sanitized = sanitized.replace(new RegExp(`[^.\\n]*${pattern.source}[^.\\n]*\\.?`, "gi"), "[REDACTED: internal audit content removed]");
  }
  sanitized += "\n\nNote: Internal audit markers were detected and redacted from this report. See compliance log.";
  return { rendered: sanitized, violations };
}
/* ══════════════════════════════════════════════════════════════════
   S-15.3 — Accrual Regime Classification in Report
══════════════════════════════════════════════════════════════════ */
export interface AccrualTableRow {
  period_end: string;
  bs_accrual_ratio: number | null;
  flag: string;
  regime: string;
  interpretation: string;
}

export function buildAccrualTable(periods: RecastPeriod[]): AccrualTableRow[] {
  return periods.slice(1).map((p) => {
    const ratio = p.ratios?.accrual_ratio_bs ?? null;
    const regime = p.ratios?.accrual_regime ?? "NORMAL";
    let flag = "OK";
    let interpretation = "";

    if (ratio != null && Math.abs(ratio) > 0.10) {
      flag = ratio > 0 ? "⚠ >10%" : "⚠ <-10%";
      switch (regime) {
        case "GROWTH_ACCRUAL":
          interpretation = "Elevated ΔNOA supported by revenue growth; earnings growth-driven.";
          break;
        case "QUALITY_ACCRUAL":
          interpretation = "High accruals without matching revenue growth; earnings persistence concern.";
          break;
        case "ASSET_DISPOSAL":
          interpretation = "Operating assets reduced; negative accruals from asset shrinkage.";
          break;
        case "CASH_GENERATION":
          interpretation = "Negative accruals indicate strong cash conversion above earnings.";
          break;
        case "CASH_ACCUMULATION":
          interpretation = "Cash accumulation producing negative NOA accruals.";
          break;
        default:
          interpretation = `Accrual ratio ${ratio != null ? (ratio * 100).toFixed(1) + "%" : "—"} exceeds ±10% threshold.`;
      }
    }

    return {
      period_end: p.period_end,
      bs_accrual_ratio: ratio,
      flag,
      regime,
      interpretation,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════
   S-16.3 — Section 6B Rendering
══════════════════════════════════════════════════════════════════ */
export type Section6BStatus = "full" | "partial" | "empty";
export interface Section6BResult {
  status: Section6BStatus;
  intrinsic_per_share: number | null;
  shares: number | null;
  shares_source: string;
  shares_confidence: string;
  market_price: number | null;
  market_cap: number | null;
  margin_of_safety: number | null;
  implied_g: number | null;
  implied_ke: number | null;
  mos_interpretation: string;
  implied_g_note: string;
  implied_ke_note: string;
  dilution_note: string;
  v_primary_over_mcap: number | null;
}

export function buildSection6B(
  shareCount: ShareCountResult,
  marketImplied: MarketImpliedResult,
  registry: CanonicalOutputRegistry
): Section6BResult {
  const shares = shareCount.shares;
  const V_primary = registry.get<number>("V_primary") ?? null;

  if (!shares || !V_primary) {
    return {
      status: "empty",
      intrinsic_per_share: null,
      shares: null,
      shares_source: shareCount.source,
      shares_confidence: shareCount.confidence,
      market_price: null,
      market_cap: null,
      margin_of_safety: null,
      implied_g: null,
      implied_ke: null,
      mos_interpretation: "",
      implied_g_note: "",
      implied_ke_note: "",
      dilution_note: shareCount.dilution_note ?? "",
      v_primary_over_mcap: null,
    };
  }

  const intrinsic_per_share = V_primary / shares;

  if (marketImplied.status === "market_price_required" || marketImplied.status === "shares_unavailable") {
    return {
      status: "partial",
      intrinsic_per_share,
      shares,
      shares_source: shareCount.source,
      shares_confidence: shareCount.confidence,
      market_price: null,
      market_cap: null,
      margin_of_safety: null,
      implied_g: null,
      implied_ke: null,
      mos_interpretation: "",
      implied_g_note: "",
      implied_ke_note: "",
      dilution_note: shareCount.dilution_note ?? "",
      v_primary_over_mcap: null,
    };
  }

  const mcap = marketImplied.market_cap ?? null;
  return {
    status: "full",
    intrinsic_per_share,
    shares,
    shares_source: shareCount.source,
    shares_confidence: shareCount.confidence,
    market_price: marketImplied.market_price ?? null,
    market_cap: mcap,
    margin_of_safety: marketImplied.margin_of_safety ?? null,
    implied_g: marketImplied.implied_g ?? null,
    implied_ke: marketImplied.implied_ke ?? null,
    mos_interpretation: marketImplied.mos_interpretation ?? "",
    implied_g_note: marketImplied.implied_g_note ?? "",
    implied_ke_note: marketImplied.implied_ke_note ?? "",
    dilution_note: shareCount.dilution_note ?? "",
    v_primary_over_mcap: mcap && mcap > 0 ? V_primary / mcap : null,
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
function numStr(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
function pctStr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
/** Full V3 analytics bundle — call once per analysis */
export interface V3AnalyticsBundle {
  validation: DataValidationResult;
  dirtySurplus: DirtySurplusSummary;
  dirtySurplusFramework: DirtySurplusFramework;
  periodFlags: PeriodEventFlags[];
  anchorResult: TerminalAnchorResult;
  confidence: ConfidenceResult;
  fadeParams: FadeParamEstimate[];
  triggers: MonitoringTrigger[];
  triggerCalibration: TriggerCalibrationResult;
  reReoiGapDecomposition: ReReOIGapDecomposition;
  oaDecomposition: OADecompositionResult[];
  accrualTable: AccrualTableRow[];
  shareCount: ShareCountResult;
  marketImplied: MarketImpliedResult;
  section6B: Section6BResult;
  versionChangeLog: VersionChangeEntry[];
  versionChangeLogMarkdown: string;
  crossSectionIssues: string[];
  registry: CanonicalOutputRegistry;
  /** Economic moat score (null if < 3 periods) */
  moatScore: MoatScoreResult | null;
  /** Capital allocation quality score */
  capitalAllocation: CapAllocScoreResult | null;
  /**
   * Phase I — cyclicality assessment. Flags whether the company's margin
   * series is structurally cyclical and where the latest period sits in
   * the cycle. UI uses this to surface peak/trough warnings on cyclical
   * businesses (Tata Steel, JSPL, Hindalco) and skip them on non-cyclicals.
   */
  cyclicality: CyclicalityAssessment;
  /**
   * Phase I — structural break detection. Flags demerger / M&A / capital
   * raise / IFRS-16 transitions where YoY changes in equity, revenue, or
   * NOA are too large to be organic. UI surfaces affected periods so users
   * can interpret persistence calculations with appropriate context.
   */
  structuralBreaks: StructuralBreakAssessment;
  /**
   * Phase I3 — loss-maker valuation alternative. Non-null only when the
   * company has CNI ≤ 0 in at least half its periods. Provides revenue-
   * multiple anchor, reverse-DCF, runway, and path-to-profitability flags
   * for cases where standard earnings-based models all skip with reason.
   */
  lossMakerValuation: LossMakerValuationResult | null;
  /** Graham-Dodd EPV (null if < 3 periods or no market data) */
  epv: EPVResult | null;
  /** Relative valuation multiples (null if no market cap in config) */
  relativeValuation: RelativeValuationResult | null;
  /**
   * Ohlson (1995) reversion CV alternative to Gordon Growth (review C11).
   * V_RE_ohlson_reversion = CSE0 + PV(RE explicit) + CV_ohlson / (1+ke)^T
   * where CV_ohlson = phi * RE_T / (1 + ke - phi).
   * Null when phi or RE_T is unavailable.
   */
  V_RE_ohlson_reversion: number | null;
  /** AR(1) phi used in the Ohlson CV after clamping/fallback. */
  phi_effective: number;
  /** Source of phi: COMPANY_SPECIFIC (OLS fit succeeded) or NP_DEFAULT (Nissim-Penman 2001 default 0.87). */
  phi_source: string;
}
export function computeV3Analytics(
  periods: RecastPeriod[],
  cfg: EngineConfig,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  gTerminalOverride?: number | null,
  kwDerived?: number,
  itServices?: import("./itServicesDetector").ITServicesSignal | null,
): V3AnalyticsBundle {
  const ke = ke_from_config(cfg);
  const kw = (() => {
    if (kwDerived != null && Number.isFinite(kwDerived) && kwDerived > 0) return kwDerived;
    if (periods.length >= 2) {
      const cur = periods[periods.length - 1];
      const prev = periods[periods.length - 2];
      return deriveKwFromStructure(cur, prev, ke, cfg.risk_free_rate, cfg);
    }
    return ke * 0.75;
  })();
  const registry = new CanonicalOutputRegistry();
  registry.register("period_count", periods.length, "S-13.3");
  registry.register("company_id", cfg.ticker ?? "Company", "S-13.3");
  registry.register("kw_derived_latest", kw, "S-13.4");
  registry.register("kw_derived_median", kw, "S-13.4");
  const validation = runDataValidation(periods);
  const dirtySurplus = computeDirtySurplus(periods, ke);
  // NOTE: DS_cumulative_all is registered by computeDirtySurplusFramework (S-15.4 single source of truth)
  // Do NOT register it here to avoid double-registration ConsistencyViolation (S-13.1)
  const periodFlags = detectPeriodEventFlags(periods, dirtySurplus);
  const anchorResult = selectTerminalAnchor(periods, periodFlags, ke, kw, gTerminalOverride);
  const pvREExplicit = periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + ke, idx + 1), 0);
  const cse0 = periods[0]?.bs.CSE ?? 0;
  const explicitPeriods = Math.max(1, periods.length - 1);
  const conservativeV = (() => {
    if (anchorResult.RE_anchor_3 == null || ke <= anchorResult.g_applied) return anchorResult.V_total;
    const cv = (anchorResult.RE_anchor_3 * (1 + anchorResult.g_applied)) / (ke - anchorResult.g_applied);
    return cse0 + pvREExplicit + cv / Math.pow(1 + ke, explicitPeriods);
  })();
  registry.register("V_primary", anchorResult.V_total, "S-14.1");
  registry.register("V_RE_CV3_guarded", anchorResult.V_total, "S-14.1");
  registry.register("V_RE_CV3_conservative", conservativeV, "S-14.1");
  registry.register("V_RE_CV3_reported", anchorResult.reference_V, "S-14.1");
  registry.register("primary_anchor_label", anchorResult.label, "S-14.1");
  registry.register("primary_anchor_source", anchorResult.anchor_method, "S-14.1");
  registry.register("tv_share_primary", anchorResult.TV_share ?? 0, "S-14.1");
  registry.register("tv_grade", anchorResult.TV_grade, "S-14.1");
  registry.register("g_effective", anchorResult.g_applied, "S-14.1");
  registry.register("g_input", gTerminalOverride ?? anchorResult.g_applied, "S-14.1");
  registry.register("g_cap_binding", anchorResult.g_source, "S-14.1");
  registry.register("tv_share_reported", anchorResult.TV_share_raw ?? 0, "S-14.1");
  registry.register("n_terminal_flags", anchorResult.terminal_event_flags.length, "S-14.1");
  const dirtySurplusFramework = computeDirtySurplusFramework(periods, periodFlags, registry);
  // Get eq16 residual from latest period with ratios
  const eq16_residual_latest = (() => {
    for (let i = periods.length - 1; i >= 0; i--) {
      const r = periods[i].ratios;
      if (r?.ROCE_eq16_error != null) return r.ROCE_eq16_error;
    }
    return null;
  })();
  const confidence = computeConfidenceScore(
    periods, dirtySurplus, anchorResult, V_RE_CV3, V_ReOI_CV03, eq16_residual_latest, registry
  );
  const reReoiGapDecomposition = decomposeReReOIGap(
    periods,
    { V_RE_CV3, V_ReOI_CV03, CSE0: periods[0]?.bs.CSE ?? 0, pvRE: 0, CV_RE: 0, CV_ReOI: 0, ke, kw },
    anchorResult.g_applied,
    registry,
  );
  const selectedOaPeriods = selectOADecompositionPeriods(periods, periodFlags);
  const oaDecomposition = selectedOaPeriods
    .map((periodEnd) => {
      const idx = periods.findIndex((p) => p.period_end === periodEnd);
      if (idx <= 0) return null;
      return renderOADecomposition(periods[idx], periods[idx - 1]);
    })
    .filter((x): x is OADecompositionResult => x != null);
  const fadeParams = estimateFadeParams(periods);

  // §9.1b: Wire phi into terminal value — Ohlson (1995) reversion CV
  //   CV_ohlson = (phi * RE_T) / (1 + ke - phi)
  //
  // Phi is the AR(1) persistence of the *abnormal earnings (RE)* series, not PM.
  // Prior implementation used PM phi as a proxy (review C9). PM persistence and
  // RE persistence are not interchangeable — a stable margin coexists with
  // declining RE when CSE grows. Estimate phi directly on the RE series when we
  // have N≥10 observations, fall back to PM phi (clamped) when RE coverage is
  // thin, and finally to the Nissim-Penman 2001 PM default (0.87) as a last
  // resort with an explicit source label so reviewers can audit the path.
  //
  // All paths clamp phi to [0, 0.95] (review C7).
  const NP_2001_PHI_PM_DEFAULT = 0.87;
  const reSeriesForPhi = periods
    .map(p => p.ri?.RE)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const phiClamp = (v: number | null): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    return Math.max(0, Math.min(0.95, v));
  };
  const phiFromRE = reSeriesForPhi.length >= 10
    ? phiClamp(estimatePhiInline(reSeriesForPhi))
    : null;
  const pmFade = fadeParams.find(f => f.driver === "PM");
  const phiFromPM = pmFade?.source === "COMPANY_SPECIFIC"
    ? phiClamp(pmFade.phi)
    : null;
  let phi_effective: number;
  let phi_source: "RE_OLS_FIT" | "PM_OLS_PROXY" | "NP_DEFAULT";
  if (phiFromRE != null) {
    phi_effective = phiFromRE;
    phi_source    = "RE_OLS_FIT";
  } else if (phiFromPM != null) {
    phi_effective = phiFromPM;
    phi_source    = "PM_OLS_PROXY";
  } else {
    phi_effective = NP_2001_PHI_PM_DEFAULT;
    phi_source    = "NP_DEFAULT";
  }
  const RE_T = anchorResult.selected_RE_anchor;
  const denominator_ohlson = 1 + ke - phi_effective;
  const CV_ohlson = (denominator_ohlson > 0.01 && RE_T != null && Number.isFinite(RE_T))
    ? (phi_effective * RE_T) / denominator_ohlson
    : null;
  const V_ohlson = CV_ohlson != null
    ? cse0 + pvREExplicit + CV_ohlson / Math.pow(1 + ke, explicitPeriods)
    : null;
  registry.register("V_RE_ohlson_reversion", V_ohlson ?? 0, "S-9.1b");
  registry.register("phi_effective", phi_effective, "S-9.1b");
  registry.register("phi_source", phi_source, "S-9.1b");
  registry.register("CV_ohlson", CV_ohlson ?? 0, "S-9.1b");

  const companyId = periods[0]?.period_end ? (cfg.ticker ?? "Company") : "Company";
  const triggerCalibration = calibrateMonitoringTriggers(periods, periodFlags, registry, cfg);
  const triggers = generateMonitoringTriggers(periods, companyId, ke, periodFlags, registry, cfg);
  const shareCount = deriveShareCount(periods, registry, anchorResult.V_total);
  const marketImplied = computeMarketImplied(
    registry,
    {
      V_primary: anchorResult.V_total,
      ke,
      g_effective: anchorResult.g_applied,
      CSE0: cse0,
      pvRE: pvREExplicit,
      explicit_periods: explicitPeriods,
      RE_anchor: anchorResult.selected_RE_anchor,
      periods,
    },
    cfg.market_price,
    cfg.shares_outstanding ?? shareCount.shares ?? undefined,
  );
  const accrualTable = buildAccrualTable(periods);
  const section6B = buildSection6B(shareCount, marketImplied, registry);
  const priorKey = `${companyId}_${periods[0]?.period_end}_${periods[periods.length - 1]?.period_end}`;
  let priorSnapshot: Record<string, unknown> | undefined;
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      const raw = globalThis.localStorage.getItem(`v3_registry_${priorKey}`);
      priorSnapshot = raw ? JSON.parse(raw) : undefined;
      globalThis.localStorage.setItem(`v3_registry_${priorKey}`, JSON.stringify(registry.snapshot()));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace("pipeline", "v3:registrySnapshot:skipped", { error: msg }, null, { level: "warn" });
    priorSnapshot = undefined;
  }
  const versionChangeLog = compareWithPriorRegistry(registry, priorSnapshot);
  const versionChangeLogMarkdown = renderVersionChangeLog(versionChangeLog);
  const crossSectionIssues = runCrossSectionAssertions(registry, {
    header: `${companyId}`,
    section1: `Terminal anchor: ${anchorResult.label}; g = ${(anchorResult.g_applied * 100).toFixed(1)}%; TV ${anchorResult.TV_grade}`,
    section7: triggers.map((t) => t.title + t.body).join("\n"),
    section6A1RowCount: periods.length - 1,
  });
  const moatScore = computeMoatScore(periods, cfg, kw, itServices);
  const capitalAllocation = periods.length >= 3 ? scoreCapitalAllocation(periods, cfg, kw) : null;
  const cyclicality = assessCyclicality(periods);
  const structuralBreaks = detectStructuralBreaks(periods);
  const lossMakerValuation = computeLossMakerValuation(periods, cfg);
  const epv = computeEPV(periods, cfg);
  const relativeValuation = cfg.market_price != null && cfg.shares_outstanding != null
    ? computeIndustrialMultiples(periods, {
        marketCap: cfg.market_price * cfg.shares_outstanding / 1e7,
        sharePrice: cfg.market_price,
      })
    : null;

  return { validation, dirtySurplus, dirtySurplusFramework, periodFlags, anchorResult, confidence, fadeParams, triggers, triggerCalibration, reReoiGapDecomposition, oaDecomposition, accrualTable, shareCount, marketImplied, section6B, versionChangeLog, versionChangeLogMarkdown, crossSectionIssues, registry, moatScore, capitalAllocation, cyclicality, structuralBreaks, lossMakerValuation, epv, relativeValuation, V_RE_ohlson_reversion: V_ohlson, phi_effective, phi_source };
}

/**
 * AR(1) phi via OLS, mirrors moatScoring.estimatePhi but kept inline to avoid
 * a circular import. Returns null on insufficient data or zero variance.
 */
function estimatePhiInline(series: number[]): number | null {
  if (series.length < 4) return null;
  const x = series.slice(0, -1);
  const y = series.slice(1);
  const n = x.length;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  const cov = x.reduce((s, v, i) => s + (v - meanX) * (y[i] - meanY), 0);
  const varX = x.reduce((s, v) => s + (v - meanX) ** 2, 0);
  if (varX < 1e-10) return null;
  return cov / varX;
}
