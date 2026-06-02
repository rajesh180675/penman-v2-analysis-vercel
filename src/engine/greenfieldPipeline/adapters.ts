import { Severity, type SpecFlag } from "../types/quality";
import { AbsoluteShares, CroreShares, INRAbsolute, INRCrore, absoluteToCrore, absoluteSharesToCrore, croreSharesToAbsolute, croreToAbsolute } from "../types/units";
import type { AnomalySignal, SeverityLevel } from "./types";

export const INR_PER_CRORE = 10_000_000;

export function croreToInrNumber(valueCr: number | null | undefined): number | null {
  return valueCr == null || !Number.isFinite(valueCr) ? null : valueCr * INR_PER_CRORE;
}

export function inrToCroreNumber(valueInr: number | null | undefined): number | null {
  return valueInr == null || !Number.isFinite(valueInr) ? null : valueInr / INR_PER_CRORE;
}

export function croreSharesToAbsoluteNumber(valueCrShares: number | null | undefined): number | null {
  return valueCrShares == null || !Number.isFinite(valueCrShares) ? null : Math.round(valueCrShares * INR_PER_CRORE);
}

export function absoluteSharesToCroreNumber(valueShares: number | null | undefined): number | null {
  return valueShares == null || !Number.isFinite(valueShares) ? null : valueShares / INR_PER_CRORE;
}

export function croreToInr(valueCr: number): number {
  return croreToAbsolute(INRCrore(valueCr)) as number;
}

export function inrToCrore(valueInr: number): number {
  return absoluteToCrore(INRAbsolute(valueInr)) as number;
}

export function croreSharesToAbsoluteLegacy(valueCrShares: number): number {
  return croreSharesToAbsolute(CroreShares(valueCrShares)) as number;
}

export function absoluteSharesToCroreLegacy(valueShares: number): number {
  return absoluteSharesToCrore(AbsoluteShares(valueShares)) as number;
}

export function severityRank(severity: SeverityLevel | "NONE"): number {
  if (severity === "CRITICAL") return 4;
  if (severity === "BLOCKING") return 3;
  if (severity === "WARNING") return 2;
  if (severity === "INFO") return 1;
  return 0;
}

export function maxSeverity(values: Array<SeverityLevel>): SeverityLevel | "NONE" {
  let best: SeverityLevel | "NONE" = "NONE";
  for (const value of values) {
    if (severityRank(value) > severityRank(best)) best = value;
  }
  return best;
}

function toSpecSeverity(severity: SeverityLevel): Severity {
  if (severity === "CRITICAL" || severity === "BLOCKING") return Severity.CRITICAL;
  if (severity === "WARNING") return Severity.WARNING;
  return Severity.INFO;
}

export function anomalySignalToSpecFlag(signal: AnomalySignal): SpecFlag {
  return {
    spec_id: `GREENFIELD.${signal.detectorId}`,
    severity: toSpecSeverity(signal.severity),
    label: signal.label,
    message: `${signal.message} p_artifact=${signal.p_artifact.toFixed(2)}`,
    affects_terminal: signal.blocksValuation || signal.severity === "CRITICAL" || signal.severity === "BLOCKING",
    period: signal.period,
  };
}
