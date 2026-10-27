import { buildScenario, buildValuationPeriodsFromForecast } from "../forecastingEngine/scenarios";
import { computeValuation } from "../PenmanNissimEngine";
import type { EngineConfig, ForecastScenario, RecastPeriod, ValuationResult } from "../types";
import type { IndustrialForecastResult } from "./contracts";
import { adaptForecastCaseToLegacyValuation, legacyValuationAnchor, type LegacyValuationPeriodInput } from "./legacyAdapter";

/**
 * The values compared: residual earnings and residual operating income at each
 * continuing value (what a scenario card is built from), the no-growth value,
 * and every model's value a share, so a mismatch the residual-income values do not read (the
 * dividends or free cash flow a case carries) is caught too.
 */
const VALUES = {
  V_RE_CV1: (valuation: ValuationResult) => valuation.V_RE_CV1,
  V_RE_CV2: (valuation: ValuationResult) => valuation.V_RE_CV2,
  V_RE_CV3: (valuation: ValuationResult) => valuation.V_RE_CV3,
  V_ReOI_CV01: (valuation: ValuationResult) => valuation.V_ReOI_CV01,
  V_ReOI_CV02: (valuation: ValuationResult) => valuation.V_ReOI_CV02,
  V_ReOI_CV03: (valuation: ValuationResult) => valuation.V_ReOI_CV03,
  // The no-growth value growth accounting is measured from, on the terminal RNOA.
  V_no_growth: (valuation: ValuationResult) => valuation.V_no_growth ?? null,
  intrinsic_re_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_re_per_share ?? null,
  intrinsic_reoi_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_reoi_per_share ?? null,
  intrinsic_fcff_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_fcff_per_share ?? null,
  intrinsic_fcfe_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_fcfe_per_share ?? null,
  intrinsic_ddm_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_ddm_per_share ?? null,
  intrinsic_aeg_per_share: (valuation: ValuationResult) => valuation.perShare?.intrinsic_aeg_per_share ?? null,
} as const;

/** Relative gap within which a forecast values as the command center's card: the bridge lands its balances to ₹1e-6 Cr. */
export const CASE_VALUATION_TOLERANCE = 1e-6;

/**
 * The forecasts a card is proved against: the forecast case the run records
 * for its scenario, and the closed-form forecast (forecastingEngine/
 * scenarios.ts) that break-even, PVRE and the forecast tab still value.
 */
export type CaseValuationSource = "forecast-case" | "closed-form";

export interface CaseValuationDivergence {
  readonly caseId: string;
  readonly source: CaseValuationSource;
  readonly field: keyof typeof VALUES;
  readonly commandCenterValue: number | null;
  readonly forecastValue: number | null;
}

/**
 * The command center values each scenario card on its forecast case, the
 * native engine's balanced statements (valuationCommandCenter/builders.ts).
 * The run records a case for each scenario too, and the closed-form forecast
 * the card was valued on before is still valued by break-even and PVRE. This
 * values both as the card was valued (same ke, kw and terminal growth, same
 * valuation config) and returns every value that disagrees with the card's:
 * a dual run, so the published values are proved on every run against each
 * forecast that is valued beside them.
 */
export function compareCaseValuations(args: {
  readonly scenarios: readonly { readonly key: string; readonly scenario: ForecastScenario; readonly valuation: ValuationResult }[];
  readonly forecastResults: readonly IndustrialForecastResult[];
  readonly anchor: RecastPeriod;
  /** The config the command center valued with, its share basis applied. */
  readonly valuationConfig: EngineConfig;
}): CaseValuationDivergence[] {
  const anchor = legacyValuationAnchor(args.anchor);
  return args.scenarios.flatMap((card) => {
    const valued = card.valuation;
    const result = args.forecastResults.find((candidate) => candidate.status === "computed" && candidate.forecastCase.caseId === card.key);
    const forecasts: { readonly source: CaseValuationSource; readonly periods: readonly LegacyValuationPeriodInput[] }[] = [
      ...(result?.status === "computed" ? [{ source: "forecast-case" as const, periods: adaptForecastCaseToLegacyValuation(anchor, result.forecastCase) }] : []),
      { source: "closed-form", periods: buildValuationPeriodsFromForecast(args.anchor, buildScenario(card.scenario, args.anchor)) },
    ];
    return forecasts.flatMap(({ source, periods }) => {
      const fromForecast = computeValuation(periods, valued.ke, valued.kw, valued.g, args.valuationConfig);
      return (Object.keys(VALUES) as (keyof typeof VALUES)[]).flatMap((field) => {
        const commandCenterValue = VALUES[field](valued);
        const forecastValue = VALUES[field](fromForecast);
        const divergence = { caseId: card.key, source, field, commandCenterValue, forecastValue };
        if (commandCenterValue == null || forecastValue == null) return commandCenterValue === forecastValue ? [] : [divergence];
        const gap = Math.abs(forecastValue - commandCenterValue) / Math.max(1, Math.abs(commandCenterValue));
        return gap <= CASE_VALUATION_TOLERANCE ? [] : [divergence];
      });
    });
  });
}
