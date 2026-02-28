import { RawPeriodData, RecastPeriod, EngineConfig } from "./types";
import {
  computeRecastPeriod, computeRatios,
  computeResidualIncome, computeQuality, deriveKwFromStructure,
} from "./PenmanNissimEngine";

export function processCompanyData(
  dataArray: RawPeriodData[],
  config: EngineConfig,
): RecastPeriod[] {
  if (!dataArray || dataArray.length === 0) return [];

  const sorted = [...dataArray].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  const results: RecastPeriod[] = [];
  const ke = config.risk_free_rate + config.equity_risk_premium;

  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    let recast: RecastPeriod;
    try {
      const prev = results.length > 0 ? results[results.length - 1] : undefined;
      recast = computeRecastPeriod(raw, config, prev);
    } catch (err) {
      console.error(`[pipeline] recast error @ ${raw.period_end}:`, err);
      continue;
    }

    if (i > 0 && results.length > 0) {
      const prev = results[results.length - 1];
      const prevRaw = sorted[i - 1];
      try {
        recast.ratios = computeRatios(recast, prev, config);
        const kwDerived = deriveKwFromStructure(recast, prev, ke, config.risk_free_rate);

        recast.ri = computeResidualIncome(recast, prev, ke, kwDerived);
        // computeQuality needs raw data for Beneish/Piotroski metric access
        recast.quality = computeQuality(recast, prev, raw, prevRaw);
      } catch (err) {
        console.error(`[pipeline] ratio/quality error @ ${raw.period_end}:`, err);
      }
    }
    results.push(recast);
  }
  return results;
}
