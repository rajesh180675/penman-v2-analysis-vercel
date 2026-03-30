import { ValuationBacktestSummary } from "./valuationCommandCenter";

export interface SignalCalibrationSummary {
  stateRankings: Array<{ state: string; count: number }>;
  strongestState: string | null;
  weakestState: string | null;
  recommendation: string;
}

export function calibrateSignalBacktest(summary: ValuationBacktestSummary): SignalCalibrationSummary {
  const rankings = Object.entries(summary.countsByState)
    .map(([state, count]) => ({ state, count }))
    .sort((left, right) => right.count - left.count);

  const strongestState =
    summary.screamingBuyCount > 0 ? "screaming-buy"
    : summary.highConvictionCount > 0 ? "high-conviction"
    : summary.investableCount > 0 ? "interesting"
    : null;

  return {
    stateRankings: rankings,
    strongestState,
    weakestState: rankings[rankings.length - 1]?.state ?? null,
    recommendation:
      summary.available
        ? `Historical replay shows ${summary.investableCount} investable points and ${summary.highConvictionCount} high-conviction points. Calibrate thresholds so strong signals stay rare.`
        : "Historical replay coverage is too thin. Add more price history or more real audited runs before trusting extreme signal labels.",
  };
}
