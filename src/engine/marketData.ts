export type LiveMarketDataFreshness = "live" | "stale" | "fallback" | "missing";

export interface MarketHistoryPoint {
  date: string;
  close: number;
}

export interface HistoricalPriceSummary {
  points: MarketHistoryPoint[];
  currentPricePercentile: number | null;
  low52Week: number | null;
  high52Week: number | null;
  distanceFrom52WeekLowPct: number | null;
  drawdownFrom52WeekHighPct: number | null;
}

export interface LiveMarketDataSnapshot {
  symbol: string | null;
  provider: string;
  fetchedAt: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
  riskFreeRate: number | null;
  priceAsOf: string | null;
  rateAsOf: string | null;
  freshness: LiveMarketDataFreshness;
  sourceSummary: string;
  warnings: string[];
  history: HistoricalPriceSummary | null;
}

export function computePercentileRank(current: number | null | undefined, series: Array<number | null | undefined>) {
  if (current == null || !Number.isFinite(current)) return null;
  const cleaned = series.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const lessOrEqual = cleaned.filter((value) => value <= current).length;
  return lessOrEqual / cleaned.length;
}

export function summarizeHistoricalPrices(points: MarketHistoryPoint[] | null | undefined, currentPrice: number | null | undefined): HistoricalPriceSummary | null {
  if (!points?.length) return null;
  const closes = points.map((point) => point.close).filter((value) => Number.isFinite(value));
  if (!closes.length) return null;
  const trailing52Week = points.slice(0, Math.min(points.length, 260));
  const trailingCloses = trailing52Week.map((point) => point.close).filter((value) => Number.isFinite(value));
  const low52Week = trailingCloses.length ? Math.min(...trailingCloses) : null;
  const high52Week = trailingCloses.length ? Math.max(...trailingCloses) : null;
  return {
    points,
    currentPricePercentile: computePercentileRank(currentPrice ?? null, closes),
    low52Week,
    high52Week,
    distanceFrom52WeekLowPct: currentPrice != null && low52Week != null && low52Week > 0 ? (currentPrice - low52Week) / low52Week : null,
    drawdownFrom52WeekHighPct: currentPrice != null && high52Week != null && high52Week > 0 ? (currentPrice - high52Week) / high52Week : null,
  };
}

