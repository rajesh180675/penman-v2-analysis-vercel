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
import { CompanyType, RecastPeriod, ValuationSectorTemplate } from "./types";
import { VALUATION_SECTOR_TEMPLATES } from "./valuationSectorTemplates";

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

type SegmentTemplate = Exclude<ValuationSectorTemplate, "auto">;

/**
 * Sector template classification rules on segment names, first match wins.
 *
 * Every keyword is a whole word. The rules were unanchored substrings, so "it"
 * in "Limited", "Commodities", "Securities" and "Utility" classed those
 * segments as IT services, "oil" in "Toiletries" as a commodity and "media" in
 * "Intermediates" as media. Tata Steel's Neelachal Ispat Nigam Limited was an
 * IT business. The telecom and utility templates were never reachable, and
 * Home Care, Beauty & Wellbeing, Mobile Services and Transmission all fell to
 * the default. Each rule's order matters where names share words: farm
 * equipment is made, not farmed, and "Hi-Tech Manufacturing" is manufacturing.
 */
const SECTOR_CLASSIFICATION_RULES: ReadonlyArray<{ pattern: RegExp; template: SegmentTemplate }> = [
  { pattern: /\b(?:cigarettes?|tobacco)\b/i, template: "consumer-staples" },
  { pattern: /\b(?:fmcg|foods?|beverages?|refreshments?|personal (?:care|products)|home care|beauty|wellbeing|soaps?|detergents?|toiletries|consumer care)\b/i, template: "consumer-staples" },
  { pattern: /\b(?:hotels?|hospitality|leisure)\b/i, template: "services" },
  { pattern: /\b(?:farm equipment|tractors?)\b/i, template: "industrials" },
  { pattern: /\b(?:agri\w*|plantations?)\b/i, template: "commodities" },
  { pattern: /\b(?:paper\w*|packaging)\b/i, template: "industrials" },
  // A cement or steel segment is valued as the engine values a cement or steel
  // company: the cyclical company type takes the commodity template.
  { pattern: /\b(?:cement|steel|ispat|metals?|mining)\b/i, template: "commodities" },
  { pattern: /\b(?:pharma\w*|health\w*|hospitals?)\b/i, template: "consumer-staples" },
  { pattern: /\b(?:telecom\w*|telemedia|mobile|broadband|towers?|passive infra\w*|homes services|digital tv|digital services)\b/i, template: "telecom" },
  { pattern: /\b(?:manufactur\w*|industrial)\b/i, template: "industrials" },
  { pattern: /\b(?:it|ites|software|technolog\w*|tech|digital)\b/i, template: "services" },
  { pattern: /\b(?:bank\w*|financ\w*|insurance|lending|treasury|securities|broking)\b/i, template: "services" },
  { pattern: /\bconsultan\w*/i, template: "services" },
  { pattern: /\bretail\w*/i, template: "retail" },
  { pattern: /\b(?:transmission|generation of (?:energy|power|electricity)|power generation|electricity|utilit(?:y|ies))\b/i, template: "utility" },
  { pattern: /\b(?:oil|gas|petro\w*|refin\w*|o2c)\b/i, template: "commodities" },
  { pattern: /\b(?:media|entertainment)\b/i, template: "services" },
  { pattern: /\b(?:real estate|propert(?:y|ies)|realty)\b/i, template: "services" },
  { pattern: /\b(?:automotive|automobiles?|auto|vehicles?|motors?|two wheelers)\b/i, template: "industrials" },
  { pattern: /\bchemicals?\b/i, template: "industrials" },
  { pattern: /\bpaints?\b/i, template: "paint" },
];

/**
 * Classify a segment name into a sector template. A name no rule matches
 * ("Others", "Airtel Business", "Fibre and Pulp") takes `fallback`: the
 * company's declared template where it has one, so a segment of a telecom
 * company is a telecom business unless its name says otherwise.
 */
export function classifySegmentSector(
  segmentName: string,
  fallback: SegmentTemplate = "industrials",
): SegmentTemplate {
  for (const rule of SECTOR_CLASSIFICATION_RULES) {
    if (rule.pattern.test(segmentName)) {
      return rule.template;
    }
  }
  return fallback;
}

/** What the company itself is, for classifying its segments. */
export interface SegmentClassificationContext {
  readonly companyType?: CompanyType | null | undefined;
  /** The template the user or the company type declares (declaredSectorTemplate), never an inferred one. */
  readonly declaredTemplate?: SegmentTemplate | null | undefined;
}

/**
 * The template a company's segment is valued on. An IT services company
 * reports by client industry, so "Retail", "Manufacturing" or "Life Sciences"
 * is a vertical of one IT business, not a retailer or a manufacturer, and every
 * segment takes the company's template.
 */
export function segmentTemplateFor(
  segmentName: string,
  context: SegmentClassificationContext = {},
): SegmentTemplate {
  if (context.companyType === "it-services") return context.declaredTemplate ?? "services";
  return classifySegmentSector(segmentName, context.declaredTemplate ?? "industrials");
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

  // Years run latest first, so a year's predecessor is the next element, and
  // the oldest year has none. (Read the other way, each year's "growth" was
  // the next-older year's change measured against the newer one.)
  const revenueGrowth = years.map((_, i) => {
    const cur = revenue[i];
    const prev = revenue[i + 1];
    return cur != null && prev != null && prev > 0 ? (cur - prev) / prev : null;
  });

  const ebitGrowth = years.map((_, i) => {
    const cur = ebit[i];
    const prev = ebit[i + 1];
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
export function seriesCagr(series: (number | null)[]): number | null {
  // The series runs latest first, as SegmentData.years does (index 0 is the
  // newest year). It was read oldest-last as if chronological, so every CAGR
  // came out inverted: Reliance's Digital Services, ₹541 Cr to ₹50,318 Cr over
  // eight years, read −43% a year, and a segment that shrank read as growing.
  const valid = series
    .map((v, i) => v != null && v > 0 ? { v, i } : null)
    .filter((x): x is { v: number; i: number } => x != null);
  if (valid.length < 2) return null;
  const latest = valid[0]!;
  const oldest = valid[valid.length - 1]!;
  const years = oldest.i - latest.i;
  if (years <= 0) return null;
  return Math.pow(latest.v / oldest.v, 1 / years) - 1;
}

/**
 * Convert parsed SegmentData into SegmentDefinition[] for SOTP valuation.
 * Uses the latest year's EBIT to compute profit shares.
 */
export function segmentDataToDefinitions(
  segmentData: SegmentData,
  yearIndex = 0, // 0 = latest year
  context: SegmentClassificationContext = {},
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
    .filter(seg => segmentEbits[seg]! > 0) // exclude loss-making segments from SOTP
    .map(seg => {
      const ebit = segmentEbits[seg]!;
      const rev = segmentRevenues[seg]!;
      const ts = timeSeries.find(t => t.name === seg);
      const revCagr = ts ? seriesCagr(ts.revenue) : null;

      const sectorTemplate = segmentTemplateFor(seg, context);
      const template = VALUATION_SECTOR_TEMPLATES[sectorTemplate];
      return {
        name: seg,
        operatingProfitShare: totalEbit > 0 ? ebit / totalEbit : 0,
        revenueShare: totalRevenue > 0 ? rev / totalRevenue : 0,
        sectorTemplate,
        // Phase C5: pass actual segment assets for NOA allocation
        segmentAssets: segmentData.data[seg]?.[year]?.assets ?? undefined,
        // Phase C5: the sector template's risk adjustment, added to the operating cost of capital
        keAdjustment: template.keAdjustment,
        // Half the segment's revenue CAGR, held inside its template's
        // terminal-growth band, as the consolidated forecast's terminal growth
        // is. The band was not applied (2–7%, above every template's cap),
        // and with the CAGR inverted the 7% went to segments that had shrunk
        // or been renamed: Tata Steel's Neelachal Ispat, HUL's Personal
        // Products. A declining segment now takes its template's floor; one
        // with no history, its cap, as before.
        terminalGrowthOverride: revCagr != null
          ? Math.min(Math.max(revCagr * 0.5, template.terminalGrowthFloor), template.terminalGrowthCap)
          : undefined,
      };
    });

  return { definitions, timeSeries };
}

/**
 * Run SOTP valuation using actual parsed segment data instead of presets.
 *
 * The consolidated NOA is allocated in proportion to each segment's filed
 * assets (`buildSOTPValuation`), or to its profit share where no segment files
 * assets (TCS and Infosys file none). Gross assets, not assets less segment
 * liabilities: 3 of the library's 66 valued segments have more liabilities
 * than assets (Airtel's DTH, Power Grid's consultancy, Tata Steel's trading
 * arm), which would allocate them negative operating assets. The liabilities
 * are reported here as context.
 */
export function runSOTPFromSegmentData(
  segmentData: SegmentData,
  latestPeriod: RecastPeriod,
  /** The operating cost of capital: segment values are operating values. */
  kw: number,
  context: SegmentClassificationContext = {},
): EnhancedSOTPResult {
  const { definitions, timeSeries } = segmentDataToDefinitions(segmentData, 0, context);
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
  const baseResult = buildSOTPValuation(latestPeriod, definitions, kw);

  return {
    ...baseResult,
    segmentTimeSeries: timeSeries,
    dataSource: "parsed",
    latestYear,
    segmentAssets,
    segmentLiabilities,
  };
}
