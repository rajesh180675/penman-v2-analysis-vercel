import { RawPeriodData, RecastPeriod } from "./types";
import { periodMetricValue } from "./rawMetricTools";

export interface QuarterlyDriverSummary {
  latestQuarterLabel: string | null;
  filingCadence: "annual-only" | "mixed" | "quarterly-ready";
  ttmRevenueProxy: number | null;
  ttmPatProxy: number | null;
  capacitySignal: string;
  priceVolumeMixSignal: string;
  drivers: {
    revenueRunRate: number | null;
    marginRunRate: number | null;
    inventoryIntensity: number | null;
    receivableIntensity: number | null;
    assetExpansionPct: number | null;
  };
}

function safeRatio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || Math.abs(denominator) < 1e-9) return null;
  return numerator / denominator;
}

function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1]! + filtered[middle]!) / 2 : filtered[middle]!;
}

export function buildQuarterlyDriverSummary(rawData: RawPeriodData[] | null | undefined, recastData: RecastPeriod[] | null | undefined): QuarterlyDriverSummary {
  const raw = rawData ?? [];
  const recast = recastData ?? [];
  const latestRaw = raw[raw.length - 1] ?? null;
  const latestRecast = recast[recast.length - 1] ?? null;
  const latestQuarterLabel = latestRaw?.period_end ?? latestRecast?.period_end ?? null;
  const quarterlyCount = raw.filter((item) => /-(06|09|12)-30$|-(09|12)-30$/.test(item.period_end) || item.period_end.endsWith("-12-31")).length;
  const filingCadence =
    quarterlyCount >= 4 ? "quarterly-ready"
    : quarterlyCount >= 1 ? "mixed"
    : "annual-only";

  const revenueSeries = raw.slice(-4).map((period) =>
    periodMetricValue(period, ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)", "Net Sale of Products"]),
  );
  const patSeries = raw.slice(-4).map((period) =>
    periodMetricValue(period, ["Profit After Tax", "Profit Attributable to Ordinary Shareholders", "Profit Attributable to Shareholders"]),
  );
  const ttmRevenueProxy = revenueSeries.every((value) => value != null) ? revenueSeries.reduce((sum, value) => sum + (value ?? 0), 0) : null;
  const ttmPatProxy = patSeries.every((value) => value != null) ? patSeries.reduce((sum, value) => sum + (value ?? 0), 0) : null;

  const revenueRunRate = ttmRevenueProxy != null ? ttmRevenueProxy / 4 : latestRecast?.is.Sales ?? null;
  const marginRunRate = ttmRevenueProxy != null && ttmPatProxy != null && ttmRevenueProxy > 0 ? ttmPatProxy / ttmRevenueProxy : latestRecast?.ratios?.PM ?? null;
  const inventoryIntensity = safeRatio(latestRecast?.bs.Inventory ?? null, latestRecast?.is.Sales ?? null);
  const receivableIntensity = safeRatio(latestRecast?.bs.TradeReceivables ?? null, latestRecast?.is.Sales ?? null);
  const assetExpansionPct =
    recast.length >= 2 && recast[recast.length - 2]!.bs.PPE !== 0
      ? (latestRecast!.bs.PPE - recast[recast.length - 2]!.bs.PPE) / Math.abs(recast[recast.length - 2]!.bs.PPE)
      : null;

  const ppeGrowth = median(
    recast.slice(-3).map((period, index, array) => {
      if (index === 0) return null;
      const prev = array[index - 1]!;
      return prev.bs.PPE !== 0 ? (period.bs.PPE - prev.bs.PPE) / Math.abs(prev.bs.PPE) : null;
    }),
  );
  const salesGrowth = median(
    recast.slice(-3).map((period, index, array) => {
      if (index === 0) return null;
      const prev = array[index - 1]!;
      return prev.is.Sales !== 0 ? (period.is.Sales - prev.is.Sales) / Math.abs(prev.is.Sales) : null;
    }),
  );

  const capacitySignal =
    ppeGrowth != null && salesGrowth != null && ppeGrowth > salesGrowth + 0.08
      ? "Capacity appears to be expanding faster than current demand, which may suppress near-term returns but support future volume."
      : ppeGrowth != null && salesGrowth != null && salesGrowth > ppeGrowth + 0.08
        ? "Sales are growing faster than fixed-asset expansion, which often implies operating leverage or tighter capacity."
        : "Capacity and sales appear to be moving broadly in line.";

  const priceVolumeMixSignal =
    marginRunRate != null && salesGrowth != null && marginRunRate > 0.12 && salesGrowth < 0.08
      ? "Margin strength is carrying more of the story than volume growth; treat this as price/mix-driven until volumes improve."
      : marginRunRate != null && salesGrowth != null && marginRunRate < 0.08 && salesGrowth > 0.12
        ? "Growth looks volume-led but lower-margin; check whether the current expansion is coming with dilution in economics."
        : "Revenue and margin behavior do not show an obvious price-volume-mix imbalance.";

  return {
    latestQuarterLabel,
    filingCadence,
    ttmRevenueProxy,
    ttmPatProxy,
    capacitySignal,
    priceVolumeMixSignal,
    drivers: {
      revenueRunRate,
      marginRunRate,
      inventoryIntensity,
      receivableIntensity,
      assetExpansionPct,
    },
  };
}
