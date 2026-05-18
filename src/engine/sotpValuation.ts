import { RecastPeriod, ValuationSectorTemplate } from "./types";
import { VALUATION_SECTOR_TEMPLATES } from "./valuationSectorTemplates";

/** Definition of a single business segment for SOTP valuation. */
export interface SegmentDefinition {
  name: string;
  /** Share of consolidated operating profit / EBIT (0-1). */
  operatingProfitShare: number;
  /** Optional revenue share (0-1) for context. */
  revenueShare?: number;
  /** Sector template to use for this segment's valuation. */
  sectorTemplate: Exclude<ValuationSectorTemplate, "auto">;
  /** Optional override: terminal growth rate for this segment. */
  terminalGrowthOverride?: number;
  /** Optional override: fade speed (higher = faster mean reversion). */
  growthFadeAlphaOverride?: number;
}

/** One segment's standalone valuation output. */
export interface SegmentValue {
  name: string;
  operatingProfit: number;
  allocatedNOA: number;
  sectorTemplateId: string;
  terminalGrowth: number;
  impliedMultiple: number | null;
  segmentValue: number;
}

/** Full SOTP result. */
export interface SOTPResult {
  segments: SegmentValue[];
  operatingSum: number;
  conglomerateDiscountPct: number;
  discountedSum: number;
  unallocatedNOA: number;
  totalEnterpriseValue: number;
  explanation: string[];
}

/** Estimate a conglomerate discount based on segment diversity.
 *  Empirical evidence: Indian conglomerates trade at 5-15% discount.
 *  More diverse segments → higher discount.
 */
export function estimateConglomerateDiscount(
  segments: SegmentDefinition[],
): { discount: number; rationale: string } {
  if (segments.length <= 1) {
    return { discount: 0, rationale: "Single segment — no conglomerate discount." };
  }

  // Count distinct sector templates as a diversity proxy
  const distinctTemplates = new Set(segments.map((s) => s.sectorTemplate));
  const shareWeights = segments.map((s) => s.operatingProfitShare);
  const maxShare = Math.max(...shareWeights);

  // Base discount scales with diversification complexity
  let discount = 0;
  if (distinctTemplates.size >= 4) {
    discount = 0.12;
  } else if (distinctTemplates.size >= 3) {
    discount = 0.08;
  } else if (distinctTemplates.size >= 2) {
    discount = 0.05;
  }

  // Higher dominance by one segment reduces discount
  if (maxShare > 0.7) {
    discount *= 0.6;
  } else if (maxShare > 0.5) {
    discount *= 0.8;
  }

  const rationale =
    segments.length <= 1
      ? "Single segment — no conglomerate discount."
      : `${segments.length} segments across ${distinctTemplates.size} distinct sectors` +
        (maxShare > 0.5
          ? `, with dominant segment at ${(maxShare * 100).toFixed(0)}% — discount moderated`
          : ", broadly balanced — full discount applied") +
        ".";

  return { discount, rationale };
}

/** Build a SOTP valuation from segment definitions and consolidated data. */
export function buildSOTPValuation(
  latest: RecastPeriod,
  segments: SegmentDefinition[],
  ke: number,
): SOTPResult {
  const totalOP = latest.is.OI;
  const totalNOA = latest.bs.NOA;

  // Allocate NOA by operating profit share (simplified — segment-level NOA
  // would require segment disclosures)
  const segmentValues: SegmentValue[] = segments.map((seg) => {
    const opProfit = totalOP * seg.operatingProfitShare;
    const allocatedNOA = totalNOA * seg.operatingProfitShare;
    const template = VALUATION_SECTOR_TEMPLATES[seg.sectorTemplate];
    const g = seg.terminalGrowthOverride ?? template.terminalGrowthCap;

    // Simple perpetuity: Segment Value = OP_after_tax / (ke - g)
    const opAfterTax = opProfit * (1 - latest.is.taxRate);
    const denom = ke - g;
    const segmentVal = denom > 0.01 ? opAfterTax / denom : null;
    const impliedMultiple = segmentVal != null && opProfit > 0 ? segmentVal / opProfit : null;

    return {
      name: seg.name,
      operatingProfit: opProfit,
      allocatedNOA,
      sectorTemplateId: seg.sectorTemplate,
      terminalGrowth: g,
      impliedMultiple,
      segmentValue: segmentVal ?? 0,
    };
  });

  const operatingSum = segmentValues.reduce((s, sv) => s + sv.segmentValue, 0);

  const { discount, rationale } = estimateConglomerateDiscount(segments);
  const discountedSum = operatingSum * (1 - discount);

  // Any NOA not captured by segment allocations
  const allocatedNOATotal = segmentValues.reduce((s, sv) => s + sv.allocatedNOA, 0);
  const unallocatedNOA = totalNOA - allocatedNOATotal;
  const totalEV = discountedSum + unallocatedNOA;

  const explanation: string[] = [
    `SOTP across ${segments.length} segment(s) using consolidated EBIT allocation.`,
    ...segmentValues.map(
      (sv) =>
        `${sv.name}: OP ${sv.operatingProfit.toFixed(0)} (${sv.sectorTemplateId}, g=${(sv.terminalGrowth * 100).toFixed(1)}%) → ${sv.segmentValue.toFixed(0)}${sv.impliedMultiple ? ` (~${sv.impliedMultiple.toFixed(1)}x OP)` : ""}`,
    ),
    `Sum-of-parts: ${operatingSum.toFixed(0)}`,
    `Conglomerate discount: ${(discount * 100).toFixed(1)}% — ${rationale}`,
    `After discount: ${discountedSum.toFixed(0)}`,
    ...(unallocatedNOA !== 0 ? [`Unallocated NOA: ${unallocatedNOA.toFixed(0)}`] : []),
    `Total EV (SOTP): ${totalEV.toFixed(0)}`,
  ];

  return {
    segments: segmentValues,
    operatingSum,
    conglomerateDiscountPct: discount,
    discountedSum,
    unallocatedNOA,
    totalEnterpriseValue: totalEV,
    explanation,
  };
}

/** Common SOTP presets for well-known Indian conglomerates. */
export const SOTP_PRESETS: Record<string, SegmentDefinition[]> = {
  ITC: [
    {
      name: "Cigarettes",
      operatingProfitShare: 0.60,
      revenueShare: 0.28,
      sectorTemplate: "consumer-staples",
    },
    {
      name: "FMCG — Others",
      operatingProfitShare: 0.20,
      revenueShare: 0.32,
      sectorTemplate: "consumer-staples",
    },
    {
      name: "Agribusiness",
      operatingProfitShare: 0.10,
      revenueShare: 0.24,
      sectorTemplate: "commodities",
    },
    {
      name: "Hotels",
      operatingProfitShare: 0.05,
      revenueShare: 0.08,
      sectorTemplate: "services",
    },
    {
      name: "Paperboard & Packaging",
      operatingProfitShare: 0.05,
      revenueShare: 0.08,
      sectorTemplate: "industrials",
    },
  ],
  "Reliance Industries": [
    {
      name: "O2C (Oil-to-Chemicals)",
      operatingProfitShare: 0.35,
      revenueShare: 0.55,
      sectorTemplate: "commodities",
    },
    {
      name: "Digital Services (Jio)",
      operatingProfitShare: 0.30,
      revenueShare: 0.18,
      sectorTemplate: "services",
    },
    {
      name: "Retail",
      operatingProfitShare: 0.15,
      revenueShare: 0.20,
      sectorTemplate: "retail",
    },
    {
      name: "Oil & Gas (E&P)",
      operatingProfitShare: 0.12,
      revenueShare: 0.04,
      sectorTemplate: "commodities",
    },
    {
      name: "Financial Services & Others",
      operatingProfitShare: 0.08,
      revenueShare: 0.03,
      sectorTemplate: "services",
    },
  ],
};
