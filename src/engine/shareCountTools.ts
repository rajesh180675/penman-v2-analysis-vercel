import { EngineConfig, RecastPeriod } from "./types";
import { CroreShares } from "./types/units";
import { CanonicalOutputRegistry, deriveShareCount, ShareCountResult } from "./v3Analytics";

export interface ResolvedShareBasis extends ShareCountResult {
  valuationConfig: EngineConfig;
}

export function resolveShareBasis(
  periods: RecastPeriod[],
  config: EngineConfig,
  fallbackVPrimary?: number | undefined,
): ResolvedShareBasis {
  if (config.shares_outstanding != null && config.shares_outstanding > 0) {
    return {
      shares: config.shares_outstanding,
      source: "Config: shares_outstanding",
      confidence: "HIGH",
      dilution_note: "Using share count supplied in configuration.",
      valuationConfig: config,
    };
  }

  const derived = deriveShareCount(periods, new CanonicalOutputRegistry(), fallbackVPrimary);
  return {
    ...derived,
    valuationConfig: derived.shares != null && derived.shares > 0
      ? { ...config, shares_outstanding: CroreShares(derived.shares) }
      : config,
  };
}

export function toPerShare(value: number | null | undefined, shares: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || shares == null || shares <= 0 || !Number.isFinite(shares)) {
    return null;
  }
  return value / shares;
}
