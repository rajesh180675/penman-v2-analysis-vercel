import { RecastPeriod } from "./types";
import { CyclicalNormalizationOutput } from "./cyclicalNormalization";

export interface TerminalEconomicsOutput {
  terminalRoic: number | null;
  terminalGrowth: number;
  terminalReinvestmentRate: number | null;
  fadeYears: number;
  competitionPressure: "low" | "medium" | "high";
  summary: string;
}

export function buildTerminalEconomics(args: {
  latest: RecastPeriod;
  normalized: CyclicalNormalizationOutput;
  requiredReturn: number;
  sectorTerminalGrowth: number;
}) {
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
  } satisfies TerminalEconomicsOutput;
}
