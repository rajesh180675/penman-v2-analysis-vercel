import type { AnalysisBadgeStatus } from "./analysisStatus";
import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import type {
  ForecastProbabilityState,
  ForecastScenarioCardSurface,
  ForecastScenarioWeighting,
} from "./types";
import type { ValuationReadiness } from "./valuationPolicy";

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

function hasVersion(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

export function buildForecastProvenance(args: {
  traceability?: AnalysisTraceabilityEnvelope | null;
  valuationReadiness: ValuationReadiness;
}) {
  const policyVersions = args.traceability?.policyVersions;
  const engineVersion = policyVersions?.engineVersion ?? null;
  const valuationPolicyVersion = policyVersions?.valuationPolicyVersion ?? null;
  const traceabilitySchemaVersion = policyVersions?.traceabilitySchemaVersion ?? null;

  return {
    generatedAt: args.traceability?.generatedAt ?? null,
    engineVersion,
    valuationPolicyVersion,
    traceabilitySchemaVersion,
    latestPeriod: args.valuationReadiness.latestPeriod,
    anchorPeriod: args.valuationReadiness.anchorPeriod,
    fallbackUsed: args.valuationReadiness.fallbackUsed,
    hasIncompleteVersionMetadata: !hasVersion(engineVersion)
      || !hasVersion(valuationPolicyVersion)
      || !hasVersion(traceabilitySchemaVersion),
  };
}
