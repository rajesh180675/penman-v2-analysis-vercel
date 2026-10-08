import { applyLendingArmCarveOut, type LendingArmReport } from "../lendingArm";
import type { SuppliedMarketPacks } from "../marketPacks/activePacks";
import type { SegmentData } from "../segmentParser";
import type { EngineConfig, RawPeriodData, RecastPeriod } from "../types";
import { annualizePeriods, periodMonths } from "./periodLength";

export { annualizePeriods, periodMonths, MAX_TRANSITION_MONTHS } from "./periodLength";
export { restampDerived } from "./restamp";

/**
 * The periods a valuation runs on, and how they differ from the filed recast.
 * The statements, ratios tabs and reconciliation stay on the recast as filed;
 * the valuation and the readiness that gates it run on these.
 */
export interface ValuationBasis {
  readonly periods: RecastPeriod[];
  /** The recast restated the same way but with no lending arm carved: the fallback when a window leaves too few carved periods. */
  readonly consolidatedPeriods: RecastPeriod[];
  readonly lendingArm: LendingArmReport | null;
  /** Periods covering other than twelve months, restated to a twelve-month rate. */
  readonly annualizedPeriods: readonly { readonly periodEnd: string; readonly months: number }[];
}

/**
 * The valuation basis: the recast with a linked lending arm carved out of the
 * whole history (src/engine/lendingArm), so the window's first year keeps a
 * carved predecessor for its ratios, and every period's flows on a
 * twelve-month rate (periodLength.ts). The carve runs first, so an arm's
 * flows leave the parent's on the period's own footing. One rule for the app's
 * run and the audit harness.
 */
export function buildValuationBasis(params: {
  readonly ticker: string | null | undefined;
  readonly periods: readonly RecastPeriod[];
  readonly rawData: readonly RawPeriodData[];
  readonly segmentData: SegmentData | null;
  readonly config: EngineConfig;
  readonly packs?: SuppliedMarketPacks | undefined;
  readonly asOf?: string | null | undefined;
  /** The run's analysis window; absent, the whole history. */
  readonly includedPeriods?: readonly string[] | null | undefined;
}): ValuationBasis {
  const months = periodMonths(params.periods);
  const consolidated = annualizePeriods(params.periods, months, params.config);
  const carve = applyLendingArmCarveOut(params);
  const basis: ValuationBasis = carve?.report.status === "applied"
    ? {
      periods: annualizePeriods(carve.periods, months, params.config).periods,
      consolidatedPeriods: consolidated.periods,
      lendingArm: carve.report,
      annualizedPeriods: consolidated.annualized,
    }
    : { periods: consolidated.periods, consolidatedPeriods: consolidated.periods, lendingArm: carve?.report ?? null, annualizedPeriods: consolidated.annualized };
  return params.includedPeriods ? windowValuationBasis(basis, params.includedPeriods) : basis;
}

/**
 * A valuation basis cut to the run's window. A carved basis with fewer than two
 * periods left in the window falls back to the consolidated periods, and says so.
 */
export function windowValuationBasis(basis: ValuationBasis, includedPeriods: readonly string[]): ValuationBasis {
  const inWindow = (period: RecastPeriod) => includedPeriods.includes(period.period_end);
  const consolidatedWindow = basis.consolidatedPeriods.filter(inWindow);
  const annualizedPeriods = basis.annualizedPeriods.filter((a) => includedPeriods.includes(a.periodEnd));
  if (basis.lendingArm?.status !== "applied") {
    return { ...basis, periods: consolidatedWindow, consolidatedPeriods: consolidatedWindow, annualizedPeriods };
  }
  const carved = basis.periods.filter(inWindow);
  if (carved.length < 2) {
    return {
      periods: consolidatedWindow,
      consolidatedPeriods: consolidatedWindow,
      lendingArm: { status: "not-applied", link: basis.lendingArm.link, reason: `Only ${carved.length} carved period${carved.length === 1 ? " falls" : "s fall"} in the analysis window.` },
      annualizedPeriods,
    };
  }
  return { ...basis, periods: carved, consolidatedPeriods: consolidatedWindow, annualizedPeriods };
}
