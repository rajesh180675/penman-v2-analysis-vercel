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

const REVENUE_ALIASES = [
  "Revenue From Operations",
  "Total Revenue from Operations",
  "Revenue From Operations(Net)",
  "Net Sale of Products",
];
const PAT_ALIASES = [
  "Profit After Tax",
  "Profit Attributable to Ordinary Shareholders",
  "Profit Attributable to Shareholders",
];

type FilingCadence = QuarterlyDriverSummary["filingCadence"];

/**
 * Cadence from date gaps, not from month-day patterns.
 *
 * Thresholds mirror `detectFrequencyWarning` in src/engine/pipeline.ts so the
 * two surfaces cannot disagree about what "quarterly" means. Pattern matching
 * on the period label cannot work: a December-fiscal-year filer's annual
 * periods all end `-12-31`, which is also a quarter end, so four annual
 * periods read as four quarters.
 *
 * Unparseable dates produce a NaN gap that matches neither band and lands the
 * series in `mixed`, which withholds the TTM proxy rather than computing one
 * from periods of unknown length.
 */
function detectCadence(sorted: RawPeriodData[]): FilingCadence {
  // One period has no gap to measure. Annual is the safe read: it makes TTM
  // the single reported figure rather than a sum over an assumed frequency.
  if (sorted.length < 2) return "annual-only";
  let quarterly = 0;
  let annual = 0;
  for (let index = 1; index < sorted.length; index++) {
    const days = (Date.parse(sorted[index]!.period_end) - Date.parse(sorted[index - 1]!.period_end)) / 86_400_000;
    if (days >= 60 && days <= 120) quarterly++;
    else if (days >= 330 && days <= 400) annual++;
  }
  const gaps = sorted.length - 1;
  if (quarterly === gaps) return "quarterly-ready";
  if (annual === gaps) return "annual-only";
  return "mixed";
}

/**
 * Trailing-twelve-month figure appropriate to the filing cadence.
 *
 * For an annual filer the trailing twelve months IS the latest fiscal year, so
 * summing the last four periods overstates it roughly fourfold. Only a
 * quarterly series sums. Mixed cadence returns null: a wrong TTM rendered
 * under a "TTM" label is worse than a blank.
 */
function ttmFor(cadence: FilingCadence, sorted: RawPeriodData[], aliases: string[]): number | null {
  if (cadence === "annual-only") {
    return periodMetricValue(sorted[sorted.length - 1] ?? null, aliases);
  }
  if (cadence === "quarterly-ready") {
    if (sorted.length < 4) return null;
    const values = sorted.slice(-4).map((period) => periodMetricValue(period, aliases));
    // Partial sums would understate the year, so require all four.
    return values.every((value) => value != null) ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
  }
  return null;
}

export function buildQuarterlyDriverSummary(rawData: RawPeriodData[] | null | undefined, recastData: RecastPeriod[] | null | undefined): QuarterlyDriverSummary {
  // Sorted by date rather than trusting array order: gap detection reads
  // consecutive differences, and a reversed input would produce negative gaps
  // that match no band and misclassify a clean annual series as mixed.
  const raw = [...(rawData ?? [])].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const recast = recastData ?? [];
  const latestRaw = raw[raw.length - 1] ?? null;
  const latestRecast = recast[recast.length - 1] ?? null;
  const latestQuarterLabel = latestRaw?.period_end ?? latestRecast?.period_end ?? null;
  const filingCadence = detectCadence(raw);

  const ttmRevenueProxy = ttmFor(filingCadence, raw, REVENUE_ALIASES);
  const ttmPatProxy = ttmFor(filingCadence, raw, PAT_ALIASES);

  // Both TTM proxies are already twelve-month figures, so the annualised run
  // rate is the proxy itself. Dividing by four here was what turned an annual
  // filer's revenue into a four-year mean.
  const revenueRunRate = ttmRevenueProxy ?? latestRecast?.is.Sales ?? null;
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
