import { RawPeriodData } from "./types";
import { periodMetricValue } from "./rawMetricTools";

export interface StatementDiagnostic {
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
  periodEnd?: string | null | undefined;
}

export interface StatementDiagnosticReport {
  diagnostics: StatementDiagnostic[];
  severityCounts: Record<StatementDiagnostic["severity"], number>;
}

function pctChange(current: number | null, previous: number | null) {
  if (current == null || previous == null || Math.abs(previous) < 1e-9) return null;
  return (current - previous) / Math.abs(previous);
}

export function buildStatementDiagnostics(periods: RawPeriodData[] | null | undefined): StatementDiagnosticReport {
  const diagnostics: StatementDiagnostic[] = [];
  const data = periods ?? [];
  for (let index = 1; index < data.length; index += 1) {
    const prev = data[index - 1];
    const current = data[index]!;
    const revenuePrev = periodMetricValue(prev, ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)", "Net Sale of Products"]);
    const revenueCur = periodMetricValue(current, ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)", "Net Sale of Products"]);
    const revenueJump = pctChange(revenueCur, revenuePrev);
    if (revenueJump != null && Math.abs(revenueJump) > 0.5) {
      diagnostics.push({
        severity: Math.abs(revenueJump) > 0.8 ? "critical" : "warning",
        label: "Revenue discontinuity",
        detail: `Revenue changed ${Math.abs(revenueJump * 100).toFixed(0)}% year over year; check for restatement, demerger, or scale drift.`,
        periodEnd: current.period_end,
      });
    }

    const assetsPrev = periodMetricValue(prev, ["Total Assets", "Total Equity and Liabilities"]);
    const assetsCur = periodMetricValue(current, ["Total Assets", "Total Equity and Liabilities"]);
    const assetJump = pctChange(assetsCur, assetsPrev);
    if (assetJump != null && Math.abs(assetJump) > 0.6) {
      diagnostics.push({
        severity: "warning",
        label: "Balance sheet regime shift",
        detail: `Total assets moved ${Math.abs(assetJump * 100).toFixed(0)}% year over year; validate accounting regime changes or major corporate actions.`,
        periodEnd: current.period_end,
      });
    }

    const taxCur = periodMetricValue(current, ["Tax Expenses"]);
    const patCur = periodMetricValue(current, ["Profit Before Tax"]);
    if (taxCur != null && patCur != null && patCur > 0) {
      const impliedTax = taxCur / patCur;
      if (impliedTax > 0.5 || impliedTax < -0.1) {
        diagnostics.push({
          severity: "warning",
          label: "Tax-rate anomaly",
          detail: `Implied tax rate is ${(impliedTax * 100).toFixed(1)}%, which is outside a normal range.`,
          periodEnd: current.period_end,
        });
      }
    }

    const sharesPrev = periodMetricValue(prev, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
    const sharesCur = periodMetricValue(current, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
    const shareJump = pctChange(sharesCur, sharesPrev);
    if (shareJump != null && Math.abs(shareJump) > 0.12) {
      diagnostics.push({
        severity: "warning",
        label: "Share-count shift",
        detail: `Share count moved ${(shareJump * 100).toFixed(0)}%; check for split, bonus, dilution, or buyback.`,
        periodEnd: current.period_end,
      });
    }
  }

  return {
    diagnostics,
    severityCounts: {
      info: diagnostics.filter((d) => d.severity === "info").length,
      warning: diagnostics.filter((d) => d.severity === "warning").length,
      critical: diagnostics.filter((d) => d.severity === "critical").length,
    },
  };
}
