/* ================================================================
   Plan 3 PR-3.1 — Pipeline strategy registry

   Selects the right PipelineStrategy at runtime. Industrial is the
   catch-all and MUST be last. PR-3.1 ships an empty registry —
   throws on selection until PR-3.2 lands the industrial strategy.
================================================================ */

import type { RawPeriodData } from "../types/raw";
import type { EngineConfig } from "../types/config";
import type { PipelineStrategy } from "./strategy";

/**
 * The active strategy registry.
 *
 * PR-3.1 ships this empty (no concrete strategies yet); each
 * subsequent PR pushes one in:
 *
 *   PR-3.2  IndustrialPipelineStrategy   (canary, catch-all)
 *   PR-3.3  BankPipelineStrategy
 *   PR-3.4  NbfcPipelineStrategy
 *   PR-3.4  InsurancePipelineStrategy
 *
 * Industrial MUST be last — its `matches()` is true for any
 * non-financial company, so an earlier match wins.
 */
const STRATEGIES: PipelineStrategy[] = [];

export function registerStrategy(strategy: PipelineStrategy): void {
  STRATEGIES.push(strategy);
}

export function selectStrategy(rawData: RawPeriodData[], config: EngineConfig): PipelineStrategy {
  const match = STRATEGIES.find((s) => s.matches(rawData, config));
  if (!match) {
    throw new Error(
      `pipeline.registry: no strategy matches company_type=${
        config.company_type ?? "auto"
      } (registry has ${STRATEGIES.length} strategies)`,
    );
  }
  return match;
}

/** For tests / introspection. Frozen so callers cannot mutate. */
export function listStrategies(): ReadonlyArray<PipelineStrategy> {
  return Object.freeze([...STRATEGIES]);
}
