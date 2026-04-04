import { BusinessModelProfile, DriverForecastPlan, RecastPeriod, TerminalEconomicsOutput } from "./types";
import { CyclicalNormalizationOutput } from "./cyclicalNormalization";

export interface LegacyTerminalEconomicsArgs {
  latest: RecastPeriod;
  normalized: CyclicalNormalizationOutput;
  requiredReturn: number;
  sectorTerminalGrowth: number;
}

export interface PersistenceTerminalEconomicsArgs {
  latest: RecastPeriod;
  normalized: CyclicalNormalizationOutput;
  businessModel: BusinessModelProfile;
  driverPlan: DriverForecastPlan;
  requiredReturn: number;
  terminalGrowthFloor: number;
  terminalGrowthCap: number;
}

export type TerminalEconomicsArgs = LegacyTerminalEconomicsArgs | PersistenceTerminalEconomicsArgs;

function hasPersistenceTerminalInputs(args: TerminalEconomicsArgs): args is PersistenceTerminalEconomicsArgs {
  return "driverPlan" in args;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildLegacyTerminalEconomics(args: LegacyTerminalEconomicsArgs): TerminalEconomicsOutput {
  const { latest, normalized, requiredReturn, sectorTerminalGrowth } = args;
  const currentRoic = latest.ratios?.ROCE ?? latest.ratios?.RNOA ?? null;
  const targetRoic = normalized.normalizedRoic ?? currentRoic ?? null;
  const cyclicalPenalty = normalized.cyclical ? 0.01 : 0;
  const terminalRoic = targetRoic != null ? Math.max(requiredReturn + 0.01, targetRoic - cyclicalPenalty) : null;
  const terminalGrowth = Math.max(0.02, Math.min(sectorTerminalGrowth, requiredReturn - 0.025));
  const terminalReinvestmentRate = terminalRoic != null && terminalRoic > 0 ? terminalGrowth / terminalRoic : null;
  const competitionPressure =
    terminalRoic == null ? "medium"
    : terminalRoic - requiredReturn > 0.05 ? "low"
    : terminalRoic - requiredReturn > 0.02 ? "medium"
    : "high";

  return {
    terminalRoic,
    terminalGrowth,
    terminalReinvestmentRate,
    fadeYears: normalized.cyclical ? 6 : 4,
    competitionPressure,
    summary:
      competitionPressure === "high"
        ? "Terminal economics assume excess returns fade quickly toward the cost of capital."
        : competitionPressure === "medium"
          ? "Terminal economics assume some excess-return durability, but not franchise immortality."
          : "Terminal economics allow persistent excess returns because recent economics remain strong even after normalization.",
    rationale: [],
  } satisfies TerminalEconomicsOutput;
}

export function buildTerminalEconomics(args: TerminalEconomicsArgs) {
  if (!hasPersistenceTerminalInputs(args)) {
    return buildLegacyTerminalEconomics(args);
  }

  const {
    latest,
    normalized,
    businessModel,
    driverPlan,
    requiredReturn,
    terminalGrowthFloor,
    terminalGrowthCap,
  } = args;

  const currentRoic = latest.ratios?.ROCE ?? latest.ratios?.RNOA ?? null;
  const normalizedRoic = normalized.normalizedRoic ?? currentRoic ?? null;
  const persistenceLift = driverPlan.persistenceBand === "durable" ? 0.015
    : driverPlan.persistenceBand === "mixed" ? 0.005
      : -0.02;
  const reinvestmentPenalty = driverPlan.reinvestmentPosture === "heavy" ? 0.012
    : driverPlan.reinvestmentPosture === "moderate" ? 0.006
      : 0;
  const workingCapitalPenalty = driverPlan.workingCapitalPressure === "high" ? 0.01
    : driverPlan.workingCapitalPressure === "medium" ? 0.004
      : 0;
  const reinvestmentQualityPenalty = businessModel.reinvestmentQualityScore < 45 ? 0.006 : businessModel.reinvestmentQualityScore < 60 ? 0.003 : 0;
  const cyclicalPenalty = normalized.cyclical ? 0.01 : 0;

  const terminalRoic = normalizedRoic != null
    ? Math.max(requiredReturn + 0.005, normalizedRoic + persistenceLift - reinvestmentPenalty - workingCapitalPenalty - reinvestmentQualityPenalty - cyclicalPenalty)
    : null;
  const terminalGrowthBase = driverPlan.targets.salesGrowth * (driverPlan.persistenceBand === "durable" ? 0.55 : driverPlan.persistenceBand === "mixed" ? 0.42 : 0.3);
  const terminalGrowth = clamp(terminalGrowthBase, terminalGrowthFloor, terminalGrowthCap);
  const fadeYears = driverPlan.persistenceBand === "durable"
    ? (normalized.cyclical ? 6 : 5)
    : driverPlan.persistenceBand === "mixed"
      ? (normalized.cyclical ? 5 : 4)
      : (normalized.cyclical ? 4 : 3);

  const rationale = [
    driverPlan.persistenceBand === "fragile"
      ? "Persistence is fragile, so excess returns compress quickly toward the cost of capital."
      : driverPlan.persistenceBand === "mixed"
        ? "Persistence is mixed, so terminal economics keep only limited credit for current excess returns."
        : "Persistence is durable enough to retain some excess returns within bounded guardrails.",
    driverPlan.reinvestmentPosture === "heavy"
      ? "Heavy reinvestment burden lowers terminal confidence."
      : "Reinvestment burden does not force extra terminal compression.",
    driverPlan.workingCapitalPressure === "high"
      ? "Weak working-capital discipline lowers terminal growth confidence."
      : "Working-capital discipline does not materially weaken terminal posture.",
    businessModel.reinvestmentQualityScore < 45
      ? "Low reinvestment quality limits the confidence we place on terminal growth conversion."
      : "Reinvestment quality is supportive enough for bounded terminal growth retention.",
  ];

  const competitionPressure = driverPlan.persistenceBand === "fragile"
    || driverPlan.workingCapitalPressure === "high"
    || driverPlan.reinvestmentPosture === "heavy"
    ? "high"
    : terminalRoic == null
      ? "medium"
      : terminalRoic - requiredReturn > 0.05 ? "low"
      : terminalRoic - requiredReturn > 0.02 ? "medium"
      : "high";

  return {
    terminalRoic,
    terminalGrowth,
    terminalReinvestmentRate: terminalRoic != null && terminalRoic > 0 ? terminalGrowth / terminalRoic : null,
    fadeYears,
    competitionPressure,
    summary: rationale[0],
    rationale,
  } satisfies TerminalEconomicsOutput;
}
