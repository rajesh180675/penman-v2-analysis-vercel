/**
 * Latest-anchored valuation periods for surfaces that hold only history.
 *
 * `computeValuation` treats `periods[0]` as the valuation date: it anchors on
 * `periods[0].bs.CSE` / `.NOA` and discounts every later period's residual
 * income back to it. Handing it the HISTORICAL series therefore valued the
 * company as of its OLDEST balance sheet — then per-share value, margin of
 * safety, implied P/B and implied growth compared that stale value against
 * TODAY's price and share count. A firm earning exactly its cost of equity
 * with book ₹1,610 today was valued at ₹1,000 (its book five years earlier),
 * i.e. −38% margin of safety where the right answer is ~0.
 *
 * The fix is the one the forecast surfaces already use: anchor at the latest
 * period and value an explicit forecast from there. This builds the SAME base
 * persistence scenario the valuation command center uses (same sector
 * template, business model and driver plan), with the caller's ke/kw/g, so the
 * Valuation tab's cards and its hero cannot disagree about the forecast.
 */
import { buildBusinessModelProfile, buildScenario, buildValuationPeriodsFromForecast, derivePersistenceForecastScenario } from "./forecastingEngine";
import type { LegacyValuationPeriodInput } from "./forecastState/legacyAdapter";
import type { EngineConfig, RecastPeriod } from "./types";
import { resolveValuationSectorTemplate } from "./valuationSectorTemplates";

export const ANCHORED_VALUATION_HORIZON = 5;

export interface AnchoredValuationPeriodsParams {
  /** Historical recast periods, oldest first. The last one is the anchor. */
  readonly history: readonly RecastPeriod[];
  readonly config: EngineConfig;
  readonly ke: number;
  readonly kw: number;
  /** Terminal growth, used as given (callers own the clamping policy). */
  readonly g: number;
  readonly riskFreeRate?: number | undefined;
  readonly horizon?: number | undefined;
}

export function buildAnchoredValuationPeriods(
  params: AnchoredValuationPeriodsParams,
): readonly LegacyValuationPeriodInput[] {
  const history = [...params.history];
  if (history.length === 0) {
    throw new Error("buildAnchoredValuationPeriods requires at least one historical period.");
  }
  const latest = history[history.length - 1]!;
  const { template } = resolveValuationSectorTemplate(history, params.config.sector_template, params.config.company_type);
  const scenario = derivePersistenceForecastScenario({
    scenarioKey: "base",
    periods: history,
    latest,
    businessModel: buildBusinessModelProfile(history),
    horizon: params.horizon ?? ANCHORED_VALUATION_HORIZON,
    template,
    riskInputs: {
      ke: params.ke,
      kw: params.kw,
      riskFreeRate: params.riskFreeRate ?? params.config.risk_free_rate,
    },
  });
  const anchored = {
    ...scenario,
    drivers: { ...scenario.drivers, ke: params.ke, kw: params.kw, g_terminal: params.g },
  };
  return buildValuationPeriodsFromForecast(latest, buildScenario(anchored, latest));
}
