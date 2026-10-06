import type {
  ForecastValidationCheck,
  IndustrialForecastCase,
  ScenarioOrderingReport,
} from "./contracts";

/**
 * Relative tolerance for "not above": rounding, not a scenario difference.
 * Values built from equal drivers by different arithmetic need not agree to
 * the last bit: Titan's bull case holds the base case's kw as
 * `structural + (base − base structural)`, and came out 0.11343525089042414
 * against the base's 0.11343525089042412 — failing "non-increasing" by 2e-17
 * and withholding valuation-eligible.
 */
const ORDERING_TOLERANCE = 1e-9;

/** a ≤ b, up to rounding. */
function notAbove(a: number, b: number): boolean {
  return a <= b + ORDERING_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

function orderingCheck(
  checkId: string,
  condition: boolean,
  observed: string,
  summary: string,
): ForecastValidationCheck {
  return {
    checkId,
    stateId: null,
    status: condition ? "passed" : "failed",
    observed,
    expected: "stress <= base <= bull",
    tolerance: ORDERING_TOLERANCE,
    summary,
  };
}

/**
 * Validate named-case ordering without assigning probabilities or synthesizing
 * values. Custom cases are ignored. A missing named case is not a failure
 * unless the caller elects to publish an ordered scenario set elsewhere.
 */
export function validateIndustrialScenarioOrdering(
  cases: readonly IndustrialForecastCase[],
): ScenarioOrderingReport {
  const stress = cases.find((forecastCase) => forecastCase.scenarioKey === "stress");
  const base = cases.find((forecastCase) => forecastCase.scenarioKey === "base");
  const bull = cases.find((forecastCase) => forecastCase.scenarioKey === "bull");
  if (!stress || !base || !bull) {
    return {
      status: "not-applicable",
      checks: [],
      summary: "Stress, base, and bull cases are all required for ordering validation.",
    };
  }

  const checks: ForecastValidationCheck[] = [];
  const sameHorizon = stress.projected.length === base.projected.length && base.projected.length === bull.projected.length;
  checks.push(orderingCheck(
    "scenario-ordering.horizon",
    sameHorizon,
    `${stress.projected.length}/${base.projected.length}/${bull.projected.length}`,
    "Named scenarios must have equal horizons before period ordering can be compared.",
  ));

  if (sameHorizon) {
    for (let index = 0; index < base.projected.length; index += 1) {
      const stressState = stress.projected[index]!;
      const baseState = base.projected[index]!;
      const bullState = bull.projected[index]!;
      const revenue = [
        stressState.incomeStatement.revenue,
        baseState.incomeStatement.revenue,
        bullState.incomeStatement.revenue,
      ];
      const operatingIncome = [
        stressState.incomeStatement.operatingIncomeAfterTax,
        baseState.incomeStatement.operatingIncomeAfterTax,
        bullState.incomeStatement.operatingIncomeAfterTax,
      ];
      checks.push(orderingCheck(
        `scenario-ordering.revenue.${index + 1}`,
        notAbove(revenue[0]!, revenue[1]!) && notAbove(revenue[1]!, revenue[2]!),
        revenue.join("/"),
        `Year ${index + 1} revenue must be monotonic from stress to bull.`,
      ));
      checks.push(orderingCheck(
        `scenario-ordering.operating-income.${index + 1}`,
        notAbove(operatingIncome[0]!, operatingIncome[1]!) && notAbove(operatingIncome[1]!, operatingIncome[2]!),
        operatingIncome.join("/"),
        `Year ${index + 1} after-tax operating income must be monotonic from stress to bull.`,
      ));
    }
  }

  checks.push(orderingCheck(
    "scenario-ordering.terminal-growth",
    notAbove(stress.terminal.growth, base.terminal.growth) && notAbove(base.terminal.growth, bull.terminal.growth),
    `${stress.terminal.growth}/${base.terminal.growth}/${bull.terminal.growth}`,
    "Terminal growth must be monotonic from stress to bull.",
  ));
  checks.push({
    ...orderingCheck(
      "scenario-ordering.kw",
      notAbove(base.terminal.kwSpread + base.terminal.growth, stress.terminal.kwSpread + stress.terminal.growth)
        && notAbove(bull.terminal.kwSpread + bull.terminal.growth, base.terminal.kwSpread + base.terminal.growth),
      `${stress.terminal.kwSpread + stress.terminal.growth}/${base.terminal.kwSpread + base.terminal.growth}/${bull.terminal.kwSpread + bull.terminal.growth}`,
      "Operating capital cost must be non-increasing from stress to bull.",
    ),
    expected: "stress >= base >= bull",
  });

  const failures = checks.filter((check) => check.status === "failed");
  return {
    status: failures.length > 0 ? "failed" : "passed",
    checks,
    summary: failures.length > 0
      ? `${failures.length} scenario ordering check(s) failed.`
      : `${checks.length} scenario ordering check(s) passed.`,
  };
}
