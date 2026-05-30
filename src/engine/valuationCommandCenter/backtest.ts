import { LiveMarketDataSnapshot, summarizeHistoricalPrices } from "../marketData";
import { INRAbsolute } from "../types/units";
import { buildCoreCommandCenter, CoreBuildContext } from "./core";
import {
  annualizedReturn,
  emptyBacktest,
  closestHistoricalPrice,
  futureHistoricalPrice,
  summarizeReturns,
} from "./helpers";
import {
  ValuationSignalState,
  ValuationBacktestPoint,
  ValuationBacktestSummary,
} from "./types";

export function buildBacktest(context: CoreBuildContext): ValuationBacktestSummary {
  const historyPoints = context.marketData?.history?.points ?? [];
  if (historyPoints.length < 120 || context.data.length < 4) {
    return emptyBacktest("Historical replay requires a meaningful price history and at least four accounting periods.");
  }

  const points: ValuationBacktestPoint[] = [];
  for (let index = 2; index < context.data.length; index += 1) {
    const subset = context.data.slice(0, index + 1);
    const periodEnd = subset[subset.length - 1]!.period_end;
    const asOfPrice = closestHistoricalPrice(historyPoints, periodEnd);
    if (!asOfPrice) continue;
    const historySubset = historyPoints.filter((point) => point.date <= asOfPrice.date);
    const historicalSnapshot: LiveMarketDataSnapshot = {
      ...(context.marketData ?? {
        symbol: context.config.market_data_symbol ?? context.config.ticker ?? null,
        provider: "Historical replay",
        fetchedAt: asOfPrice.date,
        price: asOfPrice.close,
        previousClose: null,
        changePct: null,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: context.config.risk_free_rate,
        priceAsOf: asOfPrice.date,
        rateAsOf: asOfPrice.date,
        freshness: "fallback" as const,
        sourceSummary: "Historical replay",
        warnings: [],
        history: null,
      }),
      price: asOfPrice.close,
      priceAsOf: asOfPrice.date,
      history: summarizeHistoricalPrices(historySubset, asOfPrice.close),
    };

    const core = buildCoreCommandCenter({
      ...context,
      data: subset,
      marketData: historicalSnapshot,
      config: {
        ...context.config,
        market_price: INRAbsolute(asOfPrice.close),
      },
    });

    const realized1YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365);
    const realized3YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365 * 3);
    const realized5YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365 * 5);

    points.push({
      periodEnd,
      state: core.signal.state,
      convictionBucket: core.opportunity.convictionBucket,
      marketPrice: asOfPrice.close,
      baseIntrinsicPerShare: core.scenarios.find((scenario) => scenario.key === "base")?.intrinsicPerShare ?? null,
      stressIntrinsicPerShare: core.scenarios.find((scenario) => scenario.key === "stress")?.intrinsicPerShare ?? null,
      expectedCagrStress: core.opportunity.expectedCagrStress,
      realized1Y: annualizedReturn(asOfPrice.close, realized1YPrice?.close ?? null, 1),
      realized3Y: annualizedReturn(asOfPrice.close, realized3YPrice?.close ?? null, 3),
      realized5Y: annualizedReturn(asOfPrice.close, realized5YPrice?.close ?? null, 5),
    });
  }

  if (!points.length) {
    return emptyBacktest("Historical price points could not be aligned to fiscal period-end dates.");
  }

  const countsByState: Record<ValuationSignalState, number> = {
    blocked: 0,
    guarded: 0,
    watchlist: 0,
    interesting: 0,
    "high-conviction": 0,
    "screaming-buy": 0,
  };
  for (const point of points) countsByState[point.state] += 1;

  const investablePoints = points.filter((point) => ["interesting", "high-conviction", "screaming-buy"].includes(point.state));
  const highConvictionPoints = points.filter((point) => ["high-conviction", "screaming-buy"].includes(point.state));
  const screamingBuyPoints = points.filter((point) => point.state === "screaming-buy");
  const oneYear = summarizeReturns(investablePoints, "realized1Y");
  const threeYear = summarizeReturns(highConvictionPoints.length ? highConvictionPoints : investablePoints, "realized3Y");
  const latestState = points[points.length - 1]?.state ?? "watchlist";
  const strongestHistoricalState = screamingBuyPoints.length
    ? "screaming-buy"
    : highConvictionPoints.length
      ? "high-conviction"
      : investablePoints.length
        ? "interesting"
        : "watchlist";

  return {
    available: true,
    points,
    countsByState,
    investableCount: investablePoints.length,
    highConvictionCount: highConvictionPoints.length,
    screamingBuyCount: screamingBuyPoints.length,
    forwardWinRate1Y: oneYear.winRate,
    forwardWinRate3Y: threeYear.winRate,
    median1Y: oneYear.medianValue,
    median3Y: threeYear.medianValue,
    latestComparedToHistory:
      latestState === strongestHistoricalState
        ? "The current signal matches the strongest historical state seen in the replay window."
        : `The current signal is ${latestState}; the strongest historical state seen was ${strongestHistoricalState}.`,
  };
}
