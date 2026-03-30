import { EngineConfig, RawPeriodData } from "./types";
import { periodMetricValue } from "./rawMetricTools";

export interface FinancialInstitutionValuation {
  companyId: string;
  latestPeriod: string | null;
  bookValue: number | null;
  earnings: number | null;
  shares: number | null;
  bookValuePerShare: number | null;
  earningsPerShare: number | null;
  roe: number | null;
  justifiedPb: number | null;
  justifiedValuePerShare: number | null;
  confidence: "low" | "medium";
  summary: string;
}

export function buildFinancialInstitutionValuation(periods: RawPeriodData[], config: EngineConfig): FinancialInstitutionValuation | null {
  const latest = periods[periods.length - 1];
  if (!latest) return null;
  const bookValue = periodMetricValue(latest, ["Total Equity", "Shareholders Funds", "Net Worth", "Reserve & Surplus"]);
  const earnings = periodMetricValue(latest, ["Profit After Tax", "Profit Attributable to Ordinary Shareholders", "Profit Attributable to Shareholders"]);
  const shares = periodMetricValue(latest, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued", "Weighted Average Number of Shares in Issue - Basic"]);
  const bookValuePerShare = bookValue != null && shares != null && shares > 0 ? bookValue / shares : null;
  const earningsPerShare = earnings != null && shares != null && shares > 0 ? earnings / shares : periodMetricValue(latest, ["Earning Per Share - Basic"]);
  const roe = bookValue != null && earnings != null && Math.abs(bookValue) > 1 ? earnings / bookValue : earningsPerShare != null && bookValuePerShare != null && bookValuePerShare > 0 ? earningsPerShare / bookValuePerShare : null;
  const ke = config.ke > 0 ? config.ke : config.risk_free_rate + config.equity_risk_premium;
  const growth = Math.max(0.03, Math.min(0.08, config.g_terminal_override ?? 0.05));
  const justifiedPb = roe != null && ke > growth ? Math.max(0.5, (roe - growth) / Math.max(ke - growth, 0.01)) : null;
  const justifiedValuePerShare = justifiedPb != null && bookValuePerShare != null ? justifiedPb * bookValuePerShare : null;

  return {
    companyId: latest.company_id,
    latestPeriod: latest.period_end,
    bookValue,
    earnings,
    shares,
    bookValuePerShare,
    earningsPerShare,
    roe,
    justifiedPb,
    justifiedValuePerShare,
    confidence: shares != null && bookValue != null && earnings != null ? "medium" : "low",
    summary:
      "This financial-institution path uses a book-value and ROE-based justified P/B framework instead of the industrial NOA/NFO reformulation. Treat it as a separate model family.",
  };
}
