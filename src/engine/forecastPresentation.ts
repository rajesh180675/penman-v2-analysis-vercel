import type { AnalysisBadgeStatus } from "./analysisStatus";
import type {
  ForecastProbabilityState,
  ForecastScenarioCardSurface,
  ForecastScenarioWeighting,
} from "./types";

export function normalizeScenarioWeighting(weights: ForecastScenarioWeighting) {
  const total = weights.stress + weights.base + weights.bull + weights.historicalPanic;
  return {
    weights,
    total,
    isValid: Math.abs(total - 1) < 0.001,
  };
}

export function buildForecastProbabilityState(weights: ForecastScenarioWeighting): ForecastProbabilityState {
  const normalized = normalizeScenarioWeighting(weights);
  return {
    ...normalized,
    reason: normalized.isValid ? null : `Probability sum = ${normalized.total.toFixed(2)} (must equal 1.00)`,
  };
}

export function buildForecastDisplayMode(args: {
  valuationStatus: AnalysisBadgeStatus;
  probabilityValid: boolean;
}) {
  if (args.valuationStatus === "blocked") {
    return {
      mode: "diagnostic-only" as const,
      showExpectedValue: false,
      showMonteCarlo: false,
      showActionableScenarioCards: false,
    };
  }
  if (!args.probabilityValid) {
    return {
      mode: "review-only" as const,
      showExpectedValue: false,
      showMonteCarlo: false,
      showActionableScenarioCards: true,
    };
  }
  return {
    mode: "interactive" as const,
    showExpectedValue: true,
    showMonteCarlo: true,
    showActionableScenarioCards: true,
  };
}

export function forecastScenarioLabel(key: ForecastScenarioCardSurface["key"]) {
  return key === "historical-panic" ? "panic" : key;
}
