import { ValuationBacktestSummary } from "./valuationCommandCenter";

export interface SignalCalibrationSummary {
  stateRankings: Array<{ state: string; count: number }>;
  strongestState: string | null;
  weakestState: string | null;
  recommendation: string;
  calibrationBand: "thin" | "usable" | "robust";
  alertDiscipline: string;
  hitRateSummary: string;
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
    calibrationBand:
      summary.points.length >= 10 ? "robust"
      : summary.points.length >= 4 ? "usable"
      : "thin",
    alertDiscipline:
      summary.screamingBuyCount > 2
        ? "The strongest alert is firing too often. Tighten the threshold so rare-buy alerts remain exceptional."
        : summary.highConvictionCount === 0 && summary.investableCount > 0
          ? "The system is investable but not yet discriminating sharply. Calibrate high-conviction thresholds with more history."
          : "Current signal frequency looks disciplined enough for a research alert layer.",
    hitRateSummary:
      summary.available
        ? `Forward win rate: ${summary.forwardWinRate1Y != null ? `${(summary.forwardWinRate1Y * 100).toFixed(0)}% over 1Y` : "n/a"} and ${summary.forwardWinRate3Y != null ? `${(summary.forwardWinRate3Y * 100).toFixed(0)}% over 3Y` : "n/a"}.`
        : "Historical replay coverage is too thin for stable hit-rate statistics.",
    recommendation:
      summary.available
        ? `Historical replay shows ${summary.investableCount} investable points and ${summary.highConvictionCount} high-conviction points. Calibrate thresholds so strong signals stay rare.`
        : "Historical replay coverage is too thin. Add more price history or more real audited runs before trusting extreme signal labels.",
  };
}
