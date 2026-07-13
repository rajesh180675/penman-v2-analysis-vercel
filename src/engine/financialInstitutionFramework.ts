import { EngineConfig, RawPeriodData } from "./types";
import { periodMetricValue } from "./rawMetricTools";
import { resolveCostOfCapitalFromConfig } from "./costOfCapital";

export type FinancialInstitutionKind = "bank" | "nbfc" | "insurance" | "generic-financial";

export interface FinancialInstitutionValuation {
  companyId: string;
  latestPeriod: string | null;
  institutionKind: FinancialInstitutionKind;
  bookValue: number | null;
  earnings: number | null;
  shares: number | null;
  bookValuePerShare: number | null;
  earningsPerShare: number | null;
  roe: number | null;
  justifiedPb: number | null;
  justifiedValuePerShare: number | null;
  priceTargetMethod: string;
  keyMetrics: Array<{ label: string; value: number | null; format: "pct" | "multiple" | "currency" | "number" }>;
  confidence: "low" | "medium";
  summary: string;
}

function inferInstitutionKind(period: RawPeriodData): FinancialInstitutionKind {
  const labels = Object.keys(period.raw_metric_values ?? {}).join(" ").toLowerCase();
  if (labels.includes("premium") || labels.includes("claims") || labels.includes("policyholder")) return "insurance";
  if (labels.includes("deposits") || labels.includes("casa") || labels.includes("slr") || labels.includes("interest expended")) return "bank";
  if (labels.includes("finance receivables") || labels.includes("hire purchase") || labels.includes("loan assets")) return "nbfc";
  return "generic-financial";
}

export function buildFinancialInstitutionValuation(periods: RawPeriodData[], config: EngineConfig): FinancialInstitutionValuation | null {
  const latest = periods[periods.length - 1];
  if (!latest) return null;
  const institutionKind = inferInstitutionKind(latest);
  const bookValue = periodMetricValue(latest, ["Total Equity", "Shareholders Funds", "Net Worth", "Reserve & Surplus"]);
  const earnings = periodMetricValue(latest, ["Profit After Tax", "Profit Attributable to Ordinary Shareholders", "Profit Attributable to Shareholders"]);
  const shares = periodMetricValue(latest, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued", "Weighted Average Number of Shares in Issue - Basic"]);
  const bookValuePerShare = bookValue != null && shares != null && shares > 0 ? bookValue / shares : null;
  const earningsPerShare = earnings != null && shares != null && shares > 0 ? earnings / shares : periodMetricValue(latest, ["Earning Per Share - Basic"]);
  const roe = bookValue != null && earnings != null && Math.abs(bookValue) > 1 ? earnings / bookValue : earningsPerShare != null && bookValuePerShare != null && bookValuePerShare > 0 ? earningsPerShare / bookValuePerShare : null;
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;
  const baseGrowth = Math.max(0.03, Math.min(0.08, config.g_terminal_override ?? 0.05));

  const deposits = periodMetricValue(latest, ["Deposits", "Current Account Deposits", "Savings Deposits"]);
  const interestIncome = periodMetricValue(latest, ["Interest Earned", "Interest Income", "Interest / Discount on Advances / Bills"]);
  const interestExpense = periodMetricValue(latest, ["Interest Expended", "Interest Expense", "Interest Expenses"]);
  const netInterestIncome = interestIncome != null && interestExpense != null ? interestIncome - interestExpense : null;
  const loanBook = periodMetricValue(latest, ["Loan Assets", "Advances", "Gross Advances", "Finance Receivables", "Assets on Hire Purchase"]);
  const provisions = periodMetricValue(latest, ["Provisions and Contingencies", "Impairment on Financial Instruments", "Provision for Bad and Doubtful Debts"]);
  const premiums = periodMetricValue(latest, ["Gross Written Premium", "Net Earned Premium"]);
  const claims = periodMetricValue(latest, ["Claims Incurred", "Net Claims Incurred"]);
  const policyholderFunds = periodMetricValue(latest, ["Policyholders Funds", "Life Assurance Fund"]);

  const nimProxy = netInterestIncome != null && loanBook != null && loanBook > 0 ? netInterestIncome / loanBook : null;
  const creditCost = provisions != null && loanBook != null && loanBook > 0 ? provisions / loanBook : null;
  const depositLeverage = deposits != null && bookValue != null && bookValue > 0 ? deposits / bookValue : null;
  const claimsRatio = claims != null && premiums != null && premiums > 0 ? claims / premiums : null;
  const floatRatio = policyholderFunds != null && bookValue != null && bookValue > 0 ? policyholderFunds / bookValue : null;
  const assetYield = interestIncome != null && loanBook != null && loanBook > 0 ? interestIncome / loanBook : null;

  const growth =
    institutionKind === "insurance" ? Math.min(0.06, baseGrowth)
    : institutionKind === "bank" ? Math.min(0.055, baseGrowth)
    : baseGrowth;
  const justifiedPb =
    roe != null && ke > growth
      ? Math.max(
          institutionKind === "insurance" ? 0.7 : 0.5,
          (roe - growth) / Math.max(ke - growth, 0.01),
        )
      : null;
  const justifiedValuePerShare = justifiedPb != null && bookValuePerShare != null ? justifiedPb * bookValuePerShare : null;

  const keyMetrics =
    institutionKind === "bank"
      ? [
          { label: "NIM proxy", value: nimProxy, format: "pct" as const },
          { label: "Credit cost", value: creditCost, format: "pct" as const },
          { label: "Deposit leverage", value: depositLeverage, format: "multiple" as const },
          { label: "ROE", value: roe, format: "pct" as const },
        ]
      : institutionKind === "nbfc"
        ? [
            { label: "Asset yield", value: assetYield, format: "pct" as const },
            { label: "Credit cost", value: creditCost, format: "pct" as const },
            { label: "Leverage", value: loanBook != null && bookValue != null && bookValue > 0 ? loanBook / bookValue : null, format: "multiple" as const },
            { label: "ROE", value: roe, format: "pct" as const },
          ]
        : institutionKind === "insurance"
          ? [
              { label: "Claims ratio", value: claimsRatio, format: "pct" as const },
              { label: "Float / equity", value: floatRatio, format: "multiple" as const },
              { label: "Premiums", value: premiums, format: "currency" as const },
              { label: "ROE", value: roe, format: "pct" as const },
            ]
          : [
              { label: "Book value / share", value: bookValuePerShare, format: "currency" as const },
              { label: "Earnings / share", value: earningsPerShare, format: "currency" as const },
              { label: "ROE", value: roe, format: "pct" as const },
              { label: "Justified P/B", value: justifiedPb, format: "multiple" as const },
            ];

  return {
    companyId: latest.company_id,
    latestPeriod: latest.period_end,
    institutionKind,
    bookValue,
    earnings,
    shares,
    bookValuePerShare,
    earningsPerShare,
    roe,
    justifiedPb,
    justifiedValuePerShare,
    priceTargetMethod:
      institutionKind === "bank" ? "ROE / justified P-B with NIM and credit-cost context"
      : institutionKind === "nbfc" ? "Book-value and lending-economics framework"
      : institutionKind === "insurance" ? "Book-value / float framework with claims discipline"
      : "Generic financial book-value framework",
    keyMetrics,
    confidence: shares != null && bookValue != null && earnings != null ? "medium" : "low",
    summary:
      institutionKind === "bank"
        ? "This bank framework uses book value, ROE, NIM proxy, credit-cost pressure, and deposit leverage instead of industrial NOA/NFO logic."
        : institutionKind === "nbfc"
          ? "This NBFC framework centers on book value, lending yield, credit cost, and leverage rather than industrial operating-margin decomposition."
          : institutionKind === "insurance"
            ? "This insurance framework uses book value, float, claims ratio, and ROE rather than industrial-style asset-turnover logic."
            : "This financial-institution path uses a book-value and ROE-based justified P/B framework instead of the industrial NOA/NFO reformulation. Treat it as a separate model family.",
  };
}
