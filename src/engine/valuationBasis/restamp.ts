import { computeRatios, computeResidualIncome } from "../PenmanNissimEngine";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import type { EngineConfig, RecastPeriod } from "../types";

/**
 * Re-stamp what the pipeline derives for a period from it and its predecessor
 * (kw, ratios, residual income) after a valuation-basis transform changed
 * either. Mutates `period`, which the transform has already copied. On the
 * pipeline's own basis (pipeline.ts), so transformed and untransformed periods
 * agree on it; the valuation's discount rates come from the command center.
 */
export function restampDerived(period: RecastPeriod, previous: RecastPeriod | null, config: EngineConfig): void {
  if (!previous) {
    // No predecessor: like the pipeline's first period, no ratios.
    period.ratios = undefined;
    period.ri = undefined;
    period.kwStructural = null;
    period.kwUsed = null;
    return;
  }
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;
  const capitalCost = resolveCostOfCapitalFromConfig({ config, current: period, previous });
  period.kwStructural = capitalCost.kw;
  period.kwUsed = capitalCost.kw;
  period.ratios = computeRatios(period, previous, config);
  period.ri = computeResidualIncome(period, previous, ke, capitalCost.kw);
}
