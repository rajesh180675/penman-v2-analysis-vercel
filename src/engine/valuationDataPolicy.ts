import type { RawPeriodData } from "./types";

export type ValuationPrimaryScope = "consolidated" | "standalone";

export interface ValuationDataSelection {
  primaryData: RawPeriodData[];
  primaryScope: ValuationPrimaryScope;
  usedStandaloneFallback: boolean;
  consolidatedPeriodCount: number;
  standalonePeriodCount: number;
  minRequiredPeriods: number;
  reason: string | null;
}

export const MIN_ADVANCED_VALUATION_PERIODS = 3;

/**
 * Explicit primary-data policy for valuation.
 *
 * Consolidated remains the default because it is the economically preferred
 * entity view. Standalone becomes primary only when consolidated has too few
 * periods for time-series valuation and standalone has enough history. This is
 * an explicit period-count fallback, not a label/type heuristic.
 */
export function selectPrimaryValuationData(
  consolidated: RawPeriodData[] | null,
  standalone: RawPeriodData[] | null,
  minRequiredPeriods = MIN_ADVANCED_VALUATION_PERIODS,
): ValuationDataSelection | null {
  if (!consolidated || consolidated.length === 0) return null;

  const consolidatedPeriodCount = consolidated.length;
  const standalonePeriodCount = standalone?.length ?? 0;
  const canUseStandaloneFallback =
    consolidatedPeriodCount < minRequiredPeriods
    && standalone != null
    && standalonePeriodCount >= minRequiredPeriods;

  if (canUseStandaloneFallback) {
    return {
      primaryData: standalone,
      primaryScope: "standalone",
      usedStandaloneFallback: true,
      consolidatedPeriodCount,
      standalonePeriodCount,
      minRequiredPeriods,
      reason: `Consolidated history has only ${consolidatedPeriodCount} period${consolidatedPeriodCount === 1 ? "" : "s"}; standalone has ${standalonePeriodCount} periods, so valuation uses standalone as the explicit fallback.`,
    };
  }

  return {
    primaryData: consolidated,
    primaryScope: "consolidated",
    usedStandaloneFallback: false,
    consolidatedPeriodCount,
    standalonePeriodCount,
    minRequiredPeriods,
    reason: null,
  };
}
