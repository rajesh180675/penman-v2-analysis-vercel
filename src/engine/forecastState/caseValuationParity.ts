import { computeValuation } from "../PenmanNissimEngine";
import type { EngineConfig, RecastPeriod, ValuationResult } from "../types";
import type { IndustrialForecastResult } from "./contracts";
import { adaptForecastCaseToLegacyValuation, type LegacyValuationAnchorInput } from "./legacyAdapter";

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

/** Relative gap within which a case's value is the command center's: the bridge lands its balances to ₹1e-6 Cr. */
export const CASE_VALUATION_TOLERANCE = 1e-6;

export interface CaseValuationDivergence {
  readonly caseId: string;
  readonly field: keyof typeof VALUES;
  readonly commandCenterValue: number | null;
  readonly forecastCaseValue: number | null;
}

function anchorInput(latest: RecastPeriod): LegacyValuationAnchorInput {
  return {
    periodEnd: latest.period_end,
    commonEquity: latest.bs.CSE,
    noa: latest.bs.NOA,
    nfo: latest.bs.NFO,
    minorityInterest: latest.bs.MI,
    commonNetIncome: latest.is.CNI,
    operatingIncomeAfterTax: latest.is.OI,
    dividendPaid: latest.cf.DividendPaid,
    netOwnerDistribution: latest.cf.d_t,
    rnoa: latest.ratios?.RNOA ?? null,
    separationScore: latest.bs.separationScore,
    carvedArmStakeValue: latest.bs.CarvedArmStakeValue,
  };
}

/**
 * The run values each scenario through the command center and records a
 * forecast case for it from the native engine. This values each computed case
 * as the command center valued its scenario (same ke, kw and terminal growth,
 * same valuation config) and returns every value that disagrees: a dual run,
 * so the native path is proved on every run before it is the one valued.
 */
export function compareCaseValuations(args: {
  readonly scenarios: readonly { readonly key: string; readonly valuation: ValuationResult }[];
  readonly forecastResults: readonly IndustrialForecastResult[];
  readonly anchor: RecastPeriod;
  /** The config the command center valued with, its share basis applied. */
  readonly valuationConfig: EngineConfig;
}): CaseValuationDivergence[] {
  const anchor = anchorInput(args.anchor);
  return args.scenarios.flatMap((scenario) => {
    const result = args.forecastResults.find((candidate) => candidate.status === "computed" && candidate.forecastCase.caseId === scenario.key);
    if (result?.status !== "computed") return [];
    const valued = scenario.valuation;
    const fromCase = computeValuation(
      adaptForecastCaseToLegacyValuation(anchor, result.forecastCase),
      valued.ke,
      valued.kw,
      valued.g,
      args.valuationConfig,
    );
    return (Object.keys(VALUES) as (keyof typeof VALUES)[]).flatMap((field) => {
      const commandCenterValue = VALUES[field](valued);
      const forecastCaseValue = VALUES[field](fromCase);
      if (commandCenterValue == null || forecastCaseValue == null) {
        return commandCenterValue === forecastCaseValue ? [] : [{ caseId: scenario.key, field, commandCenterValue, forecastCaseValue }];
      }
      const gap = Math.abs(forecastCaseValue - commandCenterValue) / Math.max(1, Math.abs(commandCenterValue));
      return gap <= CASE_VALUATION_TOLERANCE ? [] : [{ caseId: scenario.key, field, commandCenterValue, forecastCaseValue }];
    });
  });
}
