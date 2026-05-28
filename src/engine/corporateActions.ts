import { RawPeriodData } from "./types";
import { periodMetricValue } from "./rawMetricTools";

// ─── Thresholds (Gap 2 / PR-B) ─────────────────────────────────────────────
//
// Single source of truth for "major capital transaction" thresholds. Both
// detectCorporateActions and economicSanityGates consume these so the two
// gates never disagree on what counts as material.

/** Buyback ≥ 5% of CSE flags the period as contaminated for terminal anchor. */
export const BUYBACK_PCT_OF_CSE = 0.05;

/** Rights / equity issuance ≥ 10% of CSE flags the period as contaminated. */
export const RIGHTS_PCT_OF_CSE = 0.10;

/** Special-dividend-per-share threshold (₹/share) used to flag outsized payouts. */
export const SPECIAL_DIVIDEND_PER_SHARE = 5;

export interface CorporateActionEvent {
  kind: "split-or-bonus" | "dilution" | "buyback" | "special-dividend" | "capital-raise";
  periodEnd: string;
  detail: string;
  confidence: "low" | "medium" | "high";
}

export function detectCorporateActions(periods: RawPeriodData[] | null | undefined) {
  const data = periods ?? [];
  const events: CorporateActionEvent[] = [];
  for (let index = 1; index < data.length; index += 1) {
    const prev = data[index - 1];
    const current = data[index];
    const sharesPrev = periodMetricValue(prev, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
    const sharesCur = periodMetricValue(current, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
    const buyback = periodMetricValue(current, ["ShareBuybacks", "Buy Back of Shares", "Purchase of Own Shares"]);
    const equityIssued = periodMetricValue(current, ["EquityIssued", "Issue of Share Capital", "Proceed from Issue of Share Capital"]);
    const dividend = periodMetricValue(current, ["Dividend Paid", "Total Dividend"]);

    if (sharesPrev != null && sharesCur != null && sharesPrev > 0) {
      const change = (sharesCur - sharesPrev) / sharesPrev;
      if (change > 0.2 && equityIssued != null && equityIssued > 0) {
        events.push({
          kind: "capital-raise",
          periodEnd: current.period_end,
          detail: `Share count rose ${(change * 100).toFixed(0)}% alongside equity issuance.`,
          confidence: "high",
        });
      } else if (change > 0.1) {
        events.push({
          kind: "dilution",
          periodEnd: current.period_end,
          detail: `Share count rose ${(change * 100).toFixed(0)}%; investigate dilution, ESOPs, or corporate actions.`,
          confidence: "medium",
        });
      } else if (change < -0.03 || (buyback != null && buyback < 0)) {
        events.push({
          kind: "buyback",
          periodEnd: current.period_end,
          detail: `Share count fell ${(Math.abs(change) * 100).toFixed(0)}% or buyback cash flow was detected.`,
          confidence: buyback != null && buyback < 0 ? "high" : "medium",
        });
      } else if (change > 0.8 && change < 2.5) {
        events.push({
          kind: "split-or-bonus",
          periodEnd: current.period_end,
          detail: `Share count expanded ${(change * 100).toFixed(0)}%, consistent with a split or bonus issue.`,
          confidence: "medium",
        });
      }
    }

    if (dividend != null && dividend < 0 && sharesCur != null) {
      const dividendPerShare = Math.abs(dividend) / Math.max(sharesCur, 1);
      if (dividendPerShare > 5) {
        events.push({
          kind: "special-dividend",
          periodEnd: current.period_end,
          detail: `Dividend cash outflow implies roughly ₹${dividendPerShare.toFixed(2)} per share, suggesting an outsized payout year.`,
          confidence: "low",
        });
      }
    }
  }
  return events;
}
