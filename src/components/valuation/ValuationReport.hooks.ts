import { toPerShare } from "../../engine/shareCountTools";
import type { RecastPeriod } from "../../engine/types";
import type { computeValuation } from "../../engine/PenmanNissimEngine";
import type { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import type { useLiveMarketData } from "../../hooks/useLiveMarketData";

type ValuationResult = ReturnType<typeof computeValuation>;
type CommandCenter = ReturnType<typeof buildValuationCommandCenter>;
type LiveMarketData = ReturnType<typeof useLiveMarketData>["snapshot"];

export interface ReSeriesRow {
  period: string;
  phase: "realized" | "forecast";
  CNI: number;
  equityCharge: number;
  RE: number;
  OI: number;
  operatingCharge: number;
  ReOI: number;
}

/**
 * Realized residual income from the reported history, followed by the forecast
 * series the valuation actually discounts. The two are kept apart on purpose:
 * the valuation is anchored at the latest period, so realized RE is context,
 * not an input — and joining forecast RE to historical CNI rows (as the table
 * once did by index) would mix two different years in one row.
 */
export function buildReSeriesRows(
  history: RecastPeriod[],
  val: ValuationResult,
  ke: number,
  kw: number,
): ReSeriesRow[] {
  const realized: ReSeriesRow[] = history.slice(1).map((cur, i) => {
    const prev = history[i]!;
    const equityCharge = ke * prev.bs.CSE;
    const operatingCharge = kw * prev.bs.NOA;
    return {
      period: cur.period_end,
      phase: "realized",
      CNI: cur.is.CNI,
      equityCharge,
      RE: cur.is.CNI - equityCharge,
      OI: cur.is.OI,
      operatingCharge,
      ReOI: cur.is.OI - operatingCharge,
    };
  });
  const forecast: ReSeriesRow[] = val.reSeries.map((r) => ({
    period: r.period,
    phase: "forecast",
    CNI: Number.NaN,
    equityCharge: Number.NaN,
    RE: r.RE,
    OI: Number.NaN,
    operatingCharge: Number.NaN,
    ReOI: r.ReOI,
  }));
  return [...realized, ...forecast];
}

export function buildReSeriesBarData(rows: ReSeriesRow[], sharesOut: number | null) {
  return rows.map((r) => ({
    period: `${r.period.slice(0, 7)}${r.phase === "forecast" ? " F" : ""}`,
    phase: r.phase,
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
