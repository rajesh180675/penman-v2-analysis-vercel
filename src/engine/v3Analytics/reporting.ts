/* ================================================================
   v3Analytics decomposition — report-rendering helpers
   (§5.9 ratio summary, OA decomposition, S-15.3 accrual table).

   Lifted verbatim from src/engine/v3Analytics.ts. These are pure,
   registry-free presentation builders. Imports DOWN only: RecastPeriod
   from ../types/recast, PeriodEventFlags from ./eventFraming, numeric
   helpers from ./mathUtils. No back-edge to the parent. v3Analytics.ts
   re-exports the public surface, leaving external import paths
   (V3AnalyticsPanel, supplementaryPathA.spec) unchanged. Behaviour
   byte-for-byte identical.
================================================================ */

import type { RecastPeriod } from "../types/recast";
import type { PeriodEventFlags } from "./eventFraming";
import { medianOf, computeCagr } from "./mathUtils";

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
    ? computeCagr(valid[valid.length - 10]!, valid[valid.length - 1]!, 9)
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
  interpretation?: string | undefined;
}
export function selectOADecompositionPeriods(periods: RecastPeriod[], periodFlags: PeriodEventFlags[]): string[] {
  const selected = new Set<string>();
  if (periods.length < 2) return [];
  // Rule 1: Largest absolute ΔNOA (always included)
  const maxShiftPeriod = periods.slice(1).map((p, idx) => ({
    period_end: p.period_end,
    deltaNOA: p.bs.NOA - periods[idx]!.bs.NOA,
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
  selected.add(periods[periods.length - 1]!.period_end);
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
