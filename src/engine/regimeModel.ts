export interface RegimeContext {
  label: string;
  rateRegime: "low" | "normal" | "high";
  discountRateAdjustment: number;
  summary: string;
}

export function buildRegimeContext(riskFreeRate: number, currentPricePercentile?: number | null): RegimeContext {
  const rateRegime = riskFreeRate >= 0.08 ? "high" : riskFreeRate <= 0.05 ? "low" : "normal";
  const discountRateAdjustment = rateRegime === "high" ? 0.01 : rateRegime === "low" ? -0.005 : 0;
  const drawdownContext =
    currentPricePercentile == null ? "Historical price context is unavailable."
    : currentPricePercentile <= 0.2 ? "The stock is trading in a historically depressed zone."
    : currentPricePercentile >= 0.8 ? "The stock is trading near historically expensive levels."
    : "The stock is trading around a mid-range historical level.";

  return {
    label: `${rateRegime.toUpperCase()}-rate regime`,
    rateRegime,
    discountRateAdjustment,
    summary: `${drawdownContext} Discount-rate framing assumes a ${rateRegime} rate regime.`,
  };
}
