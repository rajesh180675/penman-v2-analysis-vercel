import { toPerShare } from "../../engine/shareCountTools";
import type { RecastPeriod } from "../../engine/types";
import type { buildCyclicalNormalization } from "../../engine/cyclicalNormalization";
import type { computeValuation } from "../../engine/PenmanNissimEngine";
import type { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import type { useLiveMarketData } from "../../hooks/useLiveMarketData";

type CyclicalNormalization = ReturnType<typeof buildCyclicalNormalization>;
type ValuationResult = ReturnType<typeof computeValuation>;
type CommandCenter = ReturnType<typeof buildValuationCommandCenter>;
type LiveMarketData = ReturnType<typeof useLiveMarketData>["snapshot"];

export function deriveCyclicalTerminalREAnchor(
  cyclicalNormalization: CyclicalNormalization,
  valuationData: RecastPeriod[],
): number | null {
  if (!cyclicalNormalization.cyclical) return null;
  const lastPeriod = valuationData[valuationData.length - 1];
  const lastRE = lastPeriod?.ri?.RE;
  const latestRNOA = lastPeriod?.ratios?.RNOA;
  const medianRNOA = cyclicalNormalization.normalizedRoic;
  if (lastRE == null || !Number.isFinite(lastRE)) return null;
  if (latestRNOA == null || !Number.isFinite(latestRNOA) || latestRNOA === 0) return null;
  if (medianRNOA == null || !Number.isFinite(medianRNOA)) return null;
  return lastRE * (medianRNOA / latestRNOA);
}

export function buildReSeriesBarData(val: ValuationResult, sharesOut: number | null) {
  return val.reSeries.map((r) => ({
    period: r.period.slice(0, 7),
    RE: +(toPerShare(r.RE, sharesOut) ?? r.RE).toFixed(2),
    ReOI: +(toPerShare(r.ReOI, sharesOut) ?? r.ReOI).toFixed(2),
  }));
}

export function buildSparklineData(liveMarketData: LiveMarketData) {
  return liveMarketData?.history?.points.slice(0, 90).reverse().map((point) => ({
    date: point.date.slice(5),
    close: point.close,
  })) ?? [];
}

export function buildSignalAuditPayload(commandCenter: CommandCenter) {
  return {
    ...commandCenter.signal,
    marketPrice: commandCenter.marketPrice,
    asOf: commandCenter.asOf,
    persistenceNarrative: commandCenter.opportunity.persistenceNarrative,
    forecastDiscipline: commandCenter.checklist.forecastDiscipline,
    scenarios: commandCenter.scenarios.map((scenario) => ({
      key: scenario.key,
      label: scenario.label,
      intrinsicPerShare: scenario.intrinsicPerShare,
      upsidePct: scenario.upsidePct,
      marginOfSafetyPct: scenario.marginOfSafetyPct,
      expectedCagr: scenario.expectedCagr,
      forecastPolicy: scenario.forecastPolicy,
    })),
  };
}

export function buildManifestAuditPayload(commandCenter: CommandCenter) {
  return {
    asOf: commandCenter.asOf,
    marketPrice: commandCenter.marketPrice,
    riskFreeRate: commandCenter.riskFreeRate,
    sectorTemplate: commandCenter.sectorTemplate,
    diagnostics: commandCenter.diagnostics,
    reverseDcf: commandCenter.reverseDcf,
    opportunity: commandCenter.opportunity,
    checklist: commandCenter.checklist,
    marketContext: commandCenter.marketContext,
    backtest: {
      available: commandCenter.backtest.available,
      investableCount: commandCenter.backtest.investableCount,
      highConvictionCount: commandCenter.backtest.highConvictionCount,
      screamingBuyCount: commandCenter.backtest.screamingBuyCount,
      forwardWinRate1Y: commandCenter.backtest.forwardWinRate1Y,
      forwardWinRate3Y: commandCenter.backtest.forwardWinRate3Y,
      median1Y: commandCenter.backtest.median1Y,
      median3Y: commandCenter.backtest.median3Y,
      latestComparedToHistory: commandCenter.backtest.latestComparedToHistory,
      points: commandCenter.backtest.points,
    },
  };
}

export function buildAlertAuditPayload(commandCenter: CommandCenter) {
  return {
    state: commandCenter.signal.state,
    label: commandCenter.signal.label,
    summary: commandCenter.signal.summary,
    opportunityScore: commandCenter.signal.opportunityScore,
    convictionBucket: commandCenter.signal.convictionBucket,
    expectedCagrStress: commandCenter.signal.expectedCagrStress,
    marketPrice: commandCenter.marketPrice,
    asOf: commandCenter.asOf,
  };
}
