import type { RecastPeriod } from "../types";
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
    /** On the anchor only: the parent's stake in a carved-out lending arm, at value, which every equity value adds. */
    readonly CarvedArmStakeValue?: number | undefined;
  };
  readonly is: {
    readonly CNI: number;
    /** After-tax operating income, matching the legacy residual-income basis. */
    readonly OI: number;
    /** The minority's share of income, when the forecast carries it: values the minority claim. */
    readonly MII?: number | undefined;
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
  /** The parent's stake in a carved-out lending arm, at value, which every equity value adds (src/engine/lendingArm). */
  readonly carvedArmStakeValue?: number | undefined;
}

/** The valuation anchor of a recast period: the scalars the command center's periods start from (buildValuationPeriodsFromForecast). */
export function legacyValuationAnchor(latest: RecastPeriod): LegacyValuationAnchorInput {
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
      ...(anchor.carvedArmStakeValue != null ? { CarvedArmStakeValue: anchor.carvedArmStakeValue } : {}),
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

  // Each field is the one the valued forecast's periods carry
  // (forecastingEngine/scenarios.ts, buildValuationPeriodsFromForecast), so a
  // case values as the command center values its forecast: the minority's
  // income values its claim, the dividend model discounts what owners receive
  // net (dividends and buybacks, less issues, floored at nil), and RNOA is on
  // the closing NOA the terminal year is valued on.
  for (const state of forecastCase.projected) {
    const cashFlow = state.cashFlow;
    const ownerDistribution = cashFlow.dividends + cashFlow.buybacks - cashFlow.shareIssueProceeds;
    const noa = state.balanceSheet.noa;
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
        MII: state.incomeStatement.minorityNetIncome,
      },
      cf: {
        DividendPaid: Math.max(0, ownerDistribution),
        d_t: ownerDistribution,
      },
      ratios: { RNOA: noa !== 0 ? state.incomeStatement.operatingIncomeAfterTax / noa : null },
    }));
  }

  return Object.freeze(periods);
}
