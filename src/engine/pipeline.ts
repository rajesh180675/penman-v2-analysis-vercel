import { RawPeriodData, RecastPeriod, EngineConfig } from "./types";
import {
  computeRecastPeriod, computeRatios,
  computeResidualIncome, computeQuality,
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
        const avgFO = (Math.abs(recast.bs.FO) + Math.abs(prev.bs.FO)) / 2;
        const avgFA = (Math.abs(recast.bs.FA) + Math.abs(prev.bs.FA)) / 2;
        const avgNOA = Math.abs((recast.bs.NOA + prev.bs.NOA) / 2);
        const kdPretax = avgFO > 1 ? Math.max(0, recast.is.FinanceCost / avgFO) : Math.max(config.risk_free_rate * 1.1, 0.04);
        const kdAfterTax = kdPretax * (1 - recast.is.taxRate);
        const ki = avgFA > 1 ? Math.max(0, recast.is.FinanceIncome / avgFA) : config.risk_free_rate;
        const kwRaw = avgNOA > 1
          ? (ke * Math.abs(recast.bs.CSE) + kdAfterTax * avgFO - ki * avgFA) / avgNOA
          : ke;
        const kwDerived = Math.max(config.risk_free_rate, Math.min(ke, kwRaw));

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
