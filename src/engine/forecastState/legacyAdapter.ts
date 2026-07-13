import type { IndustrialForecastCase } from "./contracts";

/**
 * Exact subset consumed by `computeValuation`. This is not RecastPeriod and
 * cannot accidentally acquire historical parser flags, trace maps, reported
 * tax rows, or cash-flow fields that have no projected meaning.
 */
export interface LegacyValuationPeriodInput {
  readonly period_end: string;
  readonly bs: {
    readonly CSE: number;
    readonly NOA: number;
    readonly NFO: number;
    readonly MI: number;
    readonly separationScore: number;
  };
  readonly is: {
    readonly CNI: number;
    /** After-tax operating income, matching the legacy residual-income basis. */
    readonly OI: number;
  };
  readonly cf: {
    readonly DividendPaid: number;
    /** Net common-owner distribution: dividends + buybacks - issues. */
    readonly d_t: number;
  };
  readonly ratios?: {
    readonly RNOA: number | null;
  } | undefined;
}

/** Opening period needed by residual-income discounting. Callers must map
 * these scalars explicitly from the selected, validated historical anchor.
 */
export interface LegacyValuationAnchorInput {
  readonly periodEnd: string;
  readonly commonEquity: number;
  readonly noa: number;
  readonly nfo: number;
  readonly minorityInterest: number;
  readonly commonNetIncome: number;
  readonly operatingIncomeAfterTax: number;
  readonly dividendPaid: number;
  readonly netOwnerDistribution: number;
  readonly rnoa: number | null;
  readonly separationScore: number;
}

function freezePeriod(period: LegacyValuationPeriodInput): LegacyValuationPeriodInput {
  Object.freeze(period.bs);
  Object.freeze(period.is);
  Object.freeze(period.cf);
  Object.freeze(period.ratios);
  return Object.freeze(period);
}

/**
 * Transitional, read-only bridge into the legacy valuation formula.
 *
 * Every projected nested object is constructed from forecast semantics. No
 * historical RecastPeriod is spread, no latest-period `cf` is retained, and
 * an invalid forecast cannot cross the boundary.
 */
export function adaptForecastCaseToLegacyValuation(
  anchor: LegacyValuationAnchorInput,
  forecastCase: IndustrialForecastCase,
): readonly LegacyValuationPeriodInput[] {
  if (forecastCase.validation.status !== "passed") {
    throw new Error(`Forecast case '${forecastCase.caseId}' is not valid for legacy valuation.`);
  }
  if (!forecastCase.projected.length) {
    throw new Error(`Forecast case '${forecastCase.caseId}' has no projected periods.`);
  }

  const periods: LegacyValuationPeriodInput[] = [freezePeriod({
    period_end: anchor.periodEnd,
    bs: {
      CSE: anchor.commonEquity,
      NOA: anchor.noa,
      NFO: anchor.nfo,
      MI: anchor.minorityInterest,
      separationScore: anchor.separationScore,
    },
    is: {
      CNI: anchor.commonNetIncome,
      OI: anchor.operatingIncomeAfterTax,
    },
    cf: {
      DividendPaid: anchor.dividendPaid,
      d_t: anchor.netOwnerDistribution,
    },
    ratios: { RNOA: anchor.rnoa },
  })];

  for (const state of forecastCase.projected) {
    const cashFlow = state.cashFlow;
    periods.push(freezePeriod({
      period_end: state.periodEnd,
      bs: {
        CSE: state.balanceSheet.commonEquity.total,
        NOA: state.balanceSheet.noa,
        NFO: state.balanceSheet.nfo,
        MI: state.balanceSheet.minorityInterest,
        // This is explicitly the selected historical mapping-confidence basis,
        // not a copied projected trace or a claim of new parser evidence.
        separationScore: anchor.separationScore,
      },
      is: {
        CNI: state.incomeStatement.commonNetIncome,
        OI: state.incomeStatement.operatingIncomeAfterTax,
      },
      cf: {
        DividendPaid: cashFlow.dividends,
        d_t: cashFlow.dividends + cashFlow.buybacks - cashFlow.shareIssueProceeds,
      },
      ratios: { RNOA: state.diagnostics.roic },
    }));
  }

  return Object.freeze(periods);
}
