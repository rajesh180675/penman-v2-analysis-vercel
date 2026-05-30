import { RecastPeriod, BusinessModelProfile } from "../types";
import { clamp, median, latestFinite, spreadValues } from "./helpers";

export function buildBusinessModelProfile(data: RecastPeriod[]): BusinessModelProfile {
  const salesGrowthSeries = data.map((period) => period.ratios?.Sales_growth ?? null);
  const corePmSeries = data.map((period) => period.ratios?.CoreSalesPM ?? period.ratios?.PM ?? null);
  const atoSeries = data.map((period) => period.ratios?.ATO ?? null);
  const spreadSeries = data.map((period) => period.ratios?.SPREAD ?? period.ratios?.CoreSPREAD ?? null);
  const cashConversionSeries = data.map((period) => period.ratios?.cash_conversion_ratio ?? null);
  const noaGrowthSeries = data.map((period) => period.ratios?.NOA_growth ?? null);
  const separationSeries = data.map((period) => period.bs.separationScore ?? period.ratios?.separationScore ?? null);
  const leverageSeries = data.map((period) => period.ratios?.FLEV ?? null);

  const historicalSalesGrowth = median(salesGrowthSeries.slice(0, -1));
  const historicalCorePm = median(corePmSeries.slice(0, -1));
  const historicalAto = median(atoSeries.slice(0, -1));
  const historicalSpread = median(spreadSeries.slice(0, -1));
  const historicalCashConversion = median(cashConversionSeries.slice(0, -1));

  const latestSalesGrowth = latestFinite(salesGrowthSeries);
  const latestCorePm = latestFinite(corePmSeries);
  const latestCashConversion = latestFinite(cashConversionSeries);
  const latestSpread = latestFinite(spreadSeries);
  const latestNoaGrowth = latestFinite(noaGrowthSeries);
  const latestSeparation = latestFinite(separationSeries) ?? 70;
  const latestLeverage = latestFinite(leverageSeries) ?? 0.3;

  const demandStabilityScore = clamp(
    ((0.12 - (spreadValues(salesGrowthSeries) ?? 0.12)) / 0.12) * 100,
    0,
    100,
  );
  const marginDurabilityScore = clamp(
    (
      clamp((0.12 - (spreadValues(corePmSeries) ?? 0.12)) / 0.12, 0, 1) * 0.55
      + clamp(((historicalCorePm ?? latestCorePm ?? 0) - Math.max((latestCorePm ?? 0) - (historicalCorePm ?? latestCorePm ?? 0), 0) - 0.03) / 0.15, 0, 1) * 0.25
      + clamp((latestSeparation - 55) / 40, 0, 1) * 0.2
    ) * 100,
    0,
    100,
  );
  const workingCapitalDisciplineScore = clamp(
    (
      clamp(((historicalCashConversion ?? latestCashConversion ?? 0.6) - 0.5) / 0.55, 0, 1) * 0.65
      + clamp((0.22 - Math.max((latestNoaGrowth ?? 0) - (historicalSalesGrowth ?? latestSalesGrowth ?? 0), 0)) / 0.22, 0, 1) * 0.35
    ) * 100,
    0,
    100,
  );
  const reinvestmentQualityScore = clamp(
    (
      clamp(((historicalSpread ?? latestSpread ?? 0.02) - 0.01) / 0.13, 0, 1) * 0.45
      + clamp(((historicalCashConversion ?? latestCashConversion ?? 0.6) - 0.5) / 0.55, 0, 1) * 0.25
      + clamp((0.95 - latestLeverage - 0.1) / 0.7, 0, 1) * 0.15
      + clamp((latestSeparation - 55) / 40, 0, 1) * 0.15
    ) * 100,
    0,
    100,
  );
  const capitalIntensityScore = clamp(
    (
      clamp(((historicalAto ?? latestFinite(atoSeries) ?? 0.6) - 0.35) / 1.95, 0, 1) * 0.6
      + clamp((0.95 - latestLeverage - 0.1) / 0.7, 0, 1) * 0.4
    ) * 100,
    0,
    100,
  );

  const onePeriodSpikePenalty = clamp(
    Math.max((latestCorePm ?? historicalCorePm ?? 0) - (historicalCorePm ?? latestCorePm ?? 0), 0) * 220
      + Math.max((latestSalesGrowth ?? historicalSalesGrowth ?? 0) - (historicalSalesGrowth ?? latestSalesGrowth ?? 0), 0) * 120
      + Math.max(0.7 - (latestCashConversion ?? historicalCashConversion ?? 0.7), 0) * 90,
    0,
    45,
  );

  const persistenceScore = clamp(
    demandStabilityScore * 0.2
      + marginDurabilityScore * 0.28
      + capitalIntensityScore * 0.14
      + workingCapitalDisciplineScore * 0.18
      + reinvestmentQualityScore * 0.2
      - onePeriodSpikePenalty,
    0,
    100,
  );

  const evidence: string[] = [];
  if (latestCorePm != null && historicalCorePm != null && latestCorePm > historicalCorePm * 1.35) {
    evidence.push(`Latest margin looks above the multi-year base (${(latestCorePm * 100).toFixed(1)}% vs ${(historicalCorePm * 100).toFixed(1)}%), so persistence is capped.`);
  }
  if (latestSalesGrowth != null && historicalSalesGrowth != null && latestSalesGrowth > historicalSalesGrowth * 1.5) {
    evidence.push(`Latest growth is running ahead of the multi-year base (${(latestSalesGrowth * 100).toFixed(1)}% vs ${(historicalSalesGrowth * 100).toFixed(1)}%).`);
  }
  if ((latestCashConversion ?? 1) < 0.65) {
    evidence.push(`Latest cash conversion is weak at ${((latestCashConversion ?? 0) * 100).toFixed(0)}%, which reduces persistence confidence.`);
  }
  if ((latestSeparation ?? 70) < 65) {
    evidence.push(`Latest operating-cost bridge coverage is soft, so margin persistence is treated conservatively.`);
  }
  if (!evidence.length) {
    evidence.push("Multi-year margins, reinvestment, and cash conversion appear stable enough to support slower fade assumptions.");
  }

  return {
    persistenceScore,
    demandStabilityScore,
    marginDurabilityScore,
    capitalIntensityScore,
    workingCapitalDisciplineScore,
    reinvestmentQualityScore,
    evidence,
    historicalAnchors: {
      salesGrowth: historicalSalesGrowth,
      corePm: historicalCorePm,
      ato: historicalAto,
      spread: historicalSpread,
      cashConversion: historicalCashConversion,
    },
  };
}
