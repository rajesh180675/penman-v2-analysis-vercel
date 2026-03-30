import { RecastPeriod } from "./types";
import { CyclicalNormalizationOutput } from "./cyclicalNormalization";

export interface DriverForecastSummary {
  revenueDrivers: string[];
  costDrivers: string[];
  capitalDrivers: string[];
  year1: {
    salesGrowth: number | null;
    coreMargin: number | null;
    ato: number | null;
  };
  narrative: string;
}

export function buildDriverForecastModel(data: RecastPeriod[], normalized: CyclicalNormalizationOutput): DriverForecastSummary {
  const latest = data[data.length - 1];
  const bridge = latest.is.operatingCostBridge;
  const revenueDrivers = [
    `Recent sales growth ${latest.ratios?.Sales_growth != null ? `${(latest.ratios.Sales_growth * 100).toFixed(1)}%` : "n/a"}`,
    normalized.cyclical ? "Use mid-cycle demand rather than latest-year extrapolation." : "Latest demand trend can be used with mild fade.",
    `Normalized growth anchor ${normalized.normalizedSalesGrowth != null ? `${(normalized.normalizedSalesGrowth * 100).toFixed(1)}%` : "n/a"}`,
  ];
  const costDrivers = [
    `Core margin ${latest.ratios?.CoreSalesPM != null ? `${(latest.ratios.CoreSalesPM * 100).toFixed(1)}%` : "n/a"}`,
    bridge?.driverRatios.materialCostPct != null ? `Material cost ratio ${(bridge.driverRatios.materialCostPct * 100).toFixed(1)}%` : "Detailed material-cost bridge unavailable.",
    bridge?.driverRatios.employeeCostPct != null ? `Employee cost ratio ${(bridge.driverRatios.employeeCostPct * 100).toFixed(1)}%` : "Detailed employee-cost bridge unavailable.",
  ];
  const capitalDrivers = [
    `ATO ${latest.ratios?.ATO != null ? `${latest.ratios.ATO.toFixed(2)}x` : "n/a"}`,
    `NOA growth ${latest.ratios?.NOA_growth != null ? `${(latest.ratios.NOA_growth * 100).toFixed(1)}%` : "n/a"}`,
    normalized.cyclical ? "Capex should be normalized through the cycle." : "Latest capex and working capital trends are directionally usable.",
  ];

  return {
    revenueDrivers,
    costDrivers,
    capitalDrivers,
    year1: {
      salesGrowth: normalized.normalizedSalesGrowth ?? latest.ratios?.Sales_growth ?? null,
      coreMargin: normalized.normalizedMargin ?? latest.ratios?.CoreSalesPM ?? latest.ratios?.PM ?? null,
      ato: normalized.normalizedAto ?? latest.ratios?.ATO ?? null,
    },
    narrative: normalized.cyclical
      ? "Driver-based forecasts should fade toward mid-cycle economics rather than trusting the latest period."
      : "Driver-based forecasts can start from recent economics, but should still fade toward normalized profitability and capital intensity.",
  };
}
