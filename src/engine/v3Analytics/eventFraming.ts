/* ================================================================
   Plan 2 PR-2.2 — v3Analytics decomposition.

   Cluster: dirty-surplus framework + period event flags.
   Lifted verbatim from src/engine/v3Analytics.ts. The two clusters
   share the `hasCriticalTerminalFlag` helper and reference each
   other's types, so they live in one module.

   Behaviour byte-for-byte identical; v3Analytics.ts re-exports the
   public surface so external callers see no difference.
================================================================ */

import type { RecastPeriod } from "../types/recast";
import type { CanonicalOutputRegistry } from "./shared";

/* ══════════════════════════════════════════════════════════════════
   §15.4 Dirty Surplus Framework
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
  registry?: CanonicalOutputRegistry | undefined
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

/* ═════════════════════════════════════════════════════════════════
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

export function hasCriticalTerminalFlag(flags: EventFlag[]): boolean {
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
