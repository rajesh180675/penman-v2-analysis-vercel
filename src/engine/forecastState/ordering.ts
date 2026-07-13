import type {
  ForecastValidationCheck,
  IndustrialForecastCase,
  ScenarioOrderingReport,
} from "./contracts";

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
    tolerance: null,
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
        revenue[0]! <= revenue[1]! && revenue[1]! <= revenue[2]!,
        revenue.join("/"),
        `Year ${index + 1} revenue must be monotonic from stress to bull.`,
      ));
      checks.push(orderingCheck(
        `scenario-ordering.operating-income.${index + 1}`,
        operatingIncome[0]! <= operatingIncome[1]! && operatingIncome[1]! <= operatingIncome[2]!,
        operatingIncome.join("/"),
        `Year ${index + 1} after-tax operating income must be monotonic from stress to bull.`,
      ));
    }
  }

  checks.push(orderingCheck(
    "scenario-ordering.terminal-growth",
    stress.terminal.growth <= base.terminal.growth && base.terminal.growth <= bull.terminal.growth,
    `${stress.terminal.growth}/${base.terminal.growth}/${bull.terminal.growth}`,
    "Terminal growth must be monotonic from stress to bull.",
  ));
  checks.push({
    ...orderingCheck(
      "scenario-ordering.kw",
      stress.terminal.kwSpread + stress.terminal.growth >= base.terminal.kwSpread + base.terminal.growth
        && base.terminal.kwSpread + base.terminal.growth >= bull.terminal.kwSpread + bull.terminal.growth,
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
