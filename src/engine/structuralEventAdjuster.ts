import { RecastPeriod } from "./types";

/** Result of structural event analysis for a single company. */
export interface StructuralEventAdjustment {
  periodEnd: string;
  eventType: StructuralEventType;
  rawAmount: number;
  adjusted: boolean;
  explanation: string;
}

export type StructuralEventType =
  | "discontinued-operations"
  | "special-dividend"
  | "exceptional-items"
  | "merger-acquisition";

export interface StructuralEventSummary {
  events: StructuralEventAdjustment[];
  adjustedOI: Map<string, number>;
  adjustedCSE: Map<string, number>;
  thesis: string;
  flags: string[];
}

/**
 * Analyze recast periods for structural events that distort trend analysis.
 *
 * Per the master plan §4.1: ITC structural events include:
 * - FY2025 Discontinued Operations (15.0B) — must separate continuing ops
 * - FY2021 Special Dividend (18.9B) — must flag for payout sustainability
 */
export function detectStructuralEvents(
  periods: RecastPeriod[],
): StructuralEventSummary {
  const events: StructuralEventAdjustment[] = [];
  const adjustedOI = new Map<string, number>();
  const adjustedCSE = new Map<string, number>();
  const flags: string[] = [];

  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i]!;
    const key = period.period_end;
    const coreOI = period.cu?.CoreOI ?? period.is.OI ?? 0;
    const cse = period.bs.CSE ?? 0;
    let adjOI = coreOI;
    let adjCSE = cse;

    // ── Discontinued Operations ──
    const discOps = period.cu?.DiscontinuedOperationsAfterTax ?? 0;
    if (Math.abs(discOps) > 0) {
      events.push({
        periodEnd: key,
        eventType: "discontinued-operations" as const,
        rawAmount: discOps,
        adjusted: true,
        explanation: `Discontinued operations of ${discOps.toFixed(0)} excluded from continuing-ops analysis.`,
      });
      adjOI = adjOI - discOps;
      adjCSE = adjCSE - discOps;
      flags.push(`${key}: Disc ops of ${discOps.toFixed(0)} back-adjusted from continuing operations.`);
    }

    // ── Special Dividends ──
    const dividendPaid = Math.abs(period.cf?.DividendPaid ?? 0);
    const cni = period.is?.PAT ?? 0;
    if (dividendPaid > 0 && cni > 0 && cni !== 0) {
      const payoutRatio = dividendPaid / cni;
      if (payoutRatio > 2.0) {
        events.push({
          periodEnd: key,
          eventType: "special-dividend" as const,
          rawAmount: -dividendPaid,
          adjusted: false,
          explanation: `Dividend payout of ${dividendPaid.toFixed(0)} (${payoutRatio.toFixed(0)}% of PAT) suggests special dividend.`,
        });
        flags.push(`${key}: Special dividend detected — payout ratio ${(payoutRatio * 100).toFixed(0)}% of PAT.`);
      }
    }

    // ── Exceptional Operating Items ──
    const exceptionalOps = period.cu?.ExceptionalOperatingItemsAfterTax ?? 0;
    if (Math.abs(exceptionalOps) > 0) {
      const exceptionalShareOfOI = coreOI !== 0 ? exceptionalOps / Math.abs(coreOI) : 0;
      if (Math.abs(exceptionalShareOfOI) > 0.10) {
        events.push({
          periodEnd: key,
          eventType: "exceptional-items" as const,
          rawAmount: exceptionalOps,
          adjusted: true,
          explanation: `Exceptional operating items of ${exceptionalOps.toFixed(0)} (${(exceptionalShareOfOI * 100).toFixed(0)}% of OI) excluded from trend analysis.`,
        });
        adjOI = adjOI - exceptionalOps;
        flags.push(`${key}: Exceptional operating items of ${exceptionalOps.toFixed(0)} back-adjusted.`);
      }
    }

    // ── M&A: Sudden balance-sheet shifts ──
    if (i > 0) {
      const prevPeriod = periods[i - 1];
      const ta = period.bs.TA;
      if (prevPeriod && prevPeriod.bs.TA > 0 && ta > 0) {
        const taGrowth = (ta - prevPeriod.bs.TA) / prevPeriod.bs.TA;
        if (taGrowth > 0.30) {
          events.push({
            periodEnd: key,
            eventType: "merger-acquisition" as const,
            rawAmount: ta - prevPeriod.bs.TA,
            adjusted: false,
            explanation: `Total assets grew ${(taGrowth * 100).toFixed(0)}% (${(ta - prevPeriod.bs.TA).toFixed(0)}), suggesting acquisition.`,
          });
          flags.push(`${key}: Sudden asset growth of ${(taGrowth * 100).toFixed(0)}% suggests M&A activity.`);
        }
      }
    }

    adjustedOI.set(key, adjOI);
    adjustedCSE.set(key, adjCSE);
  }

  const thesis = buildThesis(events);

  return {
    events,
    adjustedOI,
    adjustedCSE,
    thesis,
    flags,
  };
}

/** Incorporate structural event adjustments into a forecast scenario. */
export function applyStructuralAdjustments(
  summary: StructuralEventSummary,
  baseIntrinsicValue: number,
): { adjustedValue: number; rationale: string } {
  const hasDiscOps = summary.events.some((e) => e.eventType === "discontinued-operations");

  let adjustedValue = baseIntrinsicValue;
  const adjustments: string[] = [];

  if (hasDiscOps) {
    const discOpsEvents = summary.events.filter((e) => e.eventType === "discontinued-operations");
    const totalDiscOps = discOpsEvents.reduce((s, e) => s + Math.abs(e.rawAmount), 0);
    adjustments.push(`Discontinued operations of ${totalDiscOps.toFixed(0)} mean continuing ops value needs downward adjustment.`);
  }

  if (summary.events.some((e) => e.eventType === "special-dividend")) {
    adjustments.push("Special dividend year excluded from payout sustainability analysis.");
  }

  if (summary.events.some((e) => e.eventType === "exceptional-items")) {
    adjustments.push("Exceptional items years excluded from recurring earnings analysis.");
  }

  return {
    adjustedValue,
    rationale: adjustments.join(" ") || "No structural event adjustments needed.",
  };
}

function buildThesis(events: StructuralEventAdjustment[]): string {
  if (events.length === 0) return "No structural events detected that would distort the valuation analysis.";

  const discOps = events.filter((e) => e.eventType === "discontinued-operations");
  const specialDiv = events.filter((e) => e.eventType === "special-dividend");
  const exceptional = events.filter((e) => e.eventType === "exceptional-items");
  const ma = events.filter((e) => e.eventType === "merger-acquisition");

  const parts: string[] = [];
  if (discOps.length > 0) {
    parts.push(`Discontinued operations detected in ${discOps.length} period${discOps.length > 1 ? "s" : ""}. The continuing business may have different risk/return characteristics than the combined entity.`);
  }
  if (specialDiv.length > 0) {
    parts.push(`Special dividend${specialDiv.length > 1 ? "s" : ""} identified in ${specialDiv.length} period${specialDiv.length > 1 ? "s" : ""}. Payout sustainability should be assessed excluding these outlier years.`);
  }
  if (exceptional.length > 0) {
    parts.push(`Exceptional operating items are present. Valuation should focus on core, recurring operating income.`);
  }
  if (ma.length > 0) {
    parts.push(`M&A events detected. Year-over-year comparisons may be distorted by non-organic growth.`);
  }

  return parts.join(" ");
}
