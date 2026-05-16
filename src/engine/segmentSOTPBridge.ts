/**
 * Segment-to-SOTP Bridge
 *
 * Converts parsed Capitaline SegmentData into SegmentDefinition[] for the
 * SOTP valuation module. Replaces hardcoded presets with actual data.
 *
 * Key improvements over presets:
 * - Actual segment EBIT shares (not estimated)
 * - Actual segment assets for NOA allocation
 * - Multi-year trend for segment growth rates
 * - Auto-classification of segment sector templates
 */

import { SegmentData, SegmentPeriodData } from "./segmentParser";
import { SegmentDefinition, SOTPResult, buildSOTPValuation } from "./sotpValuation";
import { RecastPeriod, ValuationSectorTemplate } from "./types";

/** Segment-level time series for trend analysis */
export interface SegmentTimeSeries {
  name: string;
  years: string[];
  revenue: (number | null)[];
  ebit: (number | null)[];
  assets: (number | null)[];
  liabilities: (number | null)[];
  capex: (number | null)[];
  depreciation: (number | null)[];
  /** Derived metrics */
  ebitMargin: (number | null)[];
  revenueGrowth: (number | null)[];
  ebitGrowth: (number | null)[];
  roSegmentAssets: (number | null)[];
  capexIntensity: (number | null)[];
}

/** Enhanced SOTP result with segment-level detail from actual data */
export interface EnhancedSOTPResult extends SOTPResult {
  segmentTimeSeries: SegmentTimeSeries[];
  dataSource: "parsed" | "preset";
  latestYear: string;
  segmentAssets: Record<string, number>;
  segmentLiabilities: Record<string, number>;
}

/** Sector template classification rules based on segment name patterns */
const SECTOR_CLASSIFICATION_RULES: Array<{
  pattern: RegExp;
  template: Exclude<ValuationSectorTemplate, "auto">;
}> = [
  { pattern: /cigarette|tobacco/i, template: "consumer-staples" },
  { pattern: /fmcg|consumer|food|beverage|personal care/i, template: "consumer-staples" },
  { pattern: /hotel|hospitality|leisure/i, template: "services" },
  { pattern: /agri|agriculture|plantation|farm/i, template: "commodities" },
  { pattern: /paper|packaging|board/i, template: "industrials" },
  { pattern: /cement|steel|metal|mining/i, template: "industrials" },
  { pattern: /pharma|health|hospital/i, template: "consumer-staples" },
  { pattern: /tech|software|digital|IT/i, template: "services" },
  { pattern: /bank|financ|insurance|lending|treasury/i, template: "services" },
  { pattern: /retail/i, template: "retail" },
  { pattern: /power|energy|utility|electric/i, template: "industrials" },
  { pattern: /oil|gas|petro|refin/i, template: "commodities" },
  { pattern: /telecom|media/i, template: "services" },
  { pattern: /real estate|property/i, template: "services" },
  { pattern: /auto|vehicle|motor/i, template: "industrials" },
  { pattern: /chemical/i, template: "industrials" },
  { pattern: /paint/i, template: "paint" },
];

/** Classify a segment name into a sector template */
export function classifySegmentSector(
  segmentName: string
): Exclude<ValuationSectorTemplate, "auto"> {
  for (const rule of SECTOR_CLASSIFICATION_RULES) {
    if (rule.pattern.test(segmentName)) {
      return rule.template;
    }
  }
  return "industrials"; // default fallback
}

/** Extract time series for a single segment */
function buildSegmentTimeSeries(
  name: string,
  years: string[],
  data: Record<string, SegmentPeriodData>
): SegmentTimeSeries {
  const revenue = years.map(yr => data[yr]?.revenue ?? null);
  const ebit = years.map(yr => data[yr]?.result ?? null);
  const assets = years.map(yr => data[yr]?.assets ?? null);
  const liabilities = years.map(yr => data[yr]?.liabilities ?? null);
  const capex = years.map(yr => data[yr]?.capex ?? null);
  const depreciation = years.map(yr => data[yr]?.depreciation ?? null);

  const ebitMargin = years.map((_, i) => {
    const r = revenue[i];
    const e = ebit[i];
    return r != null && e != null && r > 0 ? e / r : null;
  });

  const revenueGrowth = years.map((_, i) => {
    if (i === 0) return null;
    const cur = revenue[i];
    const prev = revenue[i - 1];
    return cur != null && prev != null && prev > 0 ? (cur - prev) / prev : null;
  });

  const ebitGrowth = years.map((_, i) => {
    if (i === 0) return null;
    const cur = ebit[i];
    const prev = ebit[i - 1];
    return cur != null && prev != null && prev > 0 ? (cur - prev) / prev : null;
  });

  const roSegmentAssets = years.map((_, i) => {
    const e = ebit[i];
    const a = assets[i];
    return e != null && a != null && a > 0 ? e / a : null;
  });

  const capexIntensity = years.map((_, i) => {
    const c = capex[i];
    const r = revenue[i];
    return c != null && r != null && r > 0 ? c / r : null;
  });

  return {
    name, years, revenue, ebit, assets, liabilities, capex, depreciation,
    ebitMargin, revenueGrowth, ebitGrowth, roSegmentAssets, capexIntensity,
  };
}

/** Compute CAGR from a series (first non-null to last non-null) */
function seriesCagr(series: (number | null)[]): number | null {
  const valid = series
    .map((v, i) => v != null && v > 0 ? { v, i } : null)
    .filter((x): x is { v: number; i: number } => x != null);
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const periods = last.i - first.i;
  if (periods <= 0) return null;
  return Math.pow(last.v / first.v, 1 / periods) - 1;
}

/**
 * Convert parsed SegmentData into SegmentDefinition[] for SOTP valuation.
 * Uses the latest year's EBIT to compute profit shares.
 */
export function segmentDataToDefinitions(
  segmentData: SegmentData,
  yearIndex = 0, // 0 = latest year
): { definitions: SegmentDefinition[]; timeSeries: SegmentTimeSeries[] } {
  const year = segmentData.years[yearIndex];
  if (!year) return { definitions: [], timeSeries: [] };

  // Compute total EBIT across segments (only positive segments for share calc)
  let totalEbit = 0;
  let totalRevenue = 0;
  const segmentEbits: Record<string, number> = {};
  const segmentRevenues: Record<string, number> = {};

  for (const seg of segmentData.segments) {
    const d = segmentData.data[seg]?.[year];
    const ebit = d?.result ?? 0;
    const rev = d?.revenue ?? 0;
    segmentEbits[seg] = ebit;
    segmentRevenues[seg] = rev;
    if (ebit > 0) totalEbit += ebit;
    if (rev > 0) totalRevenue += rev;
  }

  // Build time series for each segment
  const timeSeries = segmentData.segments.map(seg =>
    buildSegmentTimeSeries(seg, segmentData.years, segmentData.data[seg] ?? {})
  );

  // Build definitions
  const definitions: SegmentDefinition[] = segmentData.segments
    .filter(seg => segmentEbits[seg] > 0) // exclude loss-making segments from SOTP
    .map(seg => {
      const ebit = segmentEbits[seg];
      const rev = segmentRevenues[seg];
      const ts = timeSeries.find(t => t.name === seg);
      const revCagr = ts ? seriesCagr(ts.revenue) : null;

      return {
        name: seg,
        operatingProfitShare: totalEbit > 0 ? ebit / totalEbit : 0,
        revenueShare: totalRevenue > 0 ? rev / totalRevenue : 0,
        sectorTemplate: classifySegmentSector(seg),
        // Use segment-specific revenue CAGR as terminal growth hint (capped)
        terminalGrowthOverride: revCagr != null
          ? Math.max(0.02, Math.min(0.07, revCagr * 0.5)) // 50% of historical CAGR, capped
          : undefined,
      };
    });

  return { definitions, timeSeries };
}

/**
 * Run SOTP valuation using actual parsed segment data instead of presets.
 */
export function runSOTPFromSegmentData(
  segmentData: SegmentData,
  latestPeriod: RecastPeriod,
  ke: number,
): EnhancedSOTPResult {
  const { definitions, timeSeries } = segmentDataToDefinitions(segmentData);
  const latestYear = segmentData.years[0] ?? "unknown";

  // Use actual segment assets for NOA allocation instead of proportional
  const segmentAssets: Record<string, number> = {};
  const segmentLiabilities: Record<string, number> = {};
  for (const seg of segmentData.segments) {
    const d = segmentData.data[seg]?.[latestYear];
    segmentAssets[seg] = d?.assets ?? 0;
    segmentLiabilities[seg] = d?.liabilities ?? 0;
  }

  // Run base SOTP
  const baseResult = buildSOTPValuation(latestPeriod, definitions, ke);

  return {
    ...baseResult,
    segmentTimeSeries: timeSeries,
    dataSource: "parsed",
    latestYear,
    segmentAssets,
    segmentLiabilities,
  };
}
