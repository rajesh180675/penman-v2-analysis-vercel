/**
 * Scope-Aware Data Loader
 *
 * Processes consolidated and standalone financial data together, aligning
 * periods and computing subsidiary contribution (consolidated − standalone).
 *
 * Why this matters:
 *   Consolidated = Parent + All Subsidiaries
 *   Standalone   = Parent entity only
 *   Difference   = Subsidiaries' contribution
 *
 * This is critical for SOTP validation:
 *   - Segment data shows EBIT shares within the consolidated entity
 *   - Standalone shows what the parent earns directly
 *   - The gap quantifies how much value sits in subsidiaries vs the parent
 *
 * For ITC: standalone is the cigarettes/FMCG parent; subsidiaries include
 *   ITC Hotels, ITC Infotech, etc. The gap validates the SOTP model.
 *
 * For HDFC Bank: standalone is the bank itself; consolidated adds HDFC Life,
 *   HDFC Securities, HDB Financial Services, etc.
 *
 * Usage:
 *   const result = processScopeAwareData(consolidatedPeriods, standalonePeriods, config);
 *   result.subsidiaryContribution  // per-period gap analysis
 *   result.consolidated            // full recast for consolidated
 *   result.standalone              // full recast for standalone
 */

import { RawPeriodData, RecastPeriod, EngineConfig } from "./types";
import { processCompanyDataFull, PipelineResult } from "./pipeline";

// ─── Output Types ─────────────────────────────────────────────────────────────

/** Key metrics extracted from a RecastPeriod for contribution analysis */
export interface ScopeMetricSnapshot {
  period_end: string;
  sales: number | null;
  pat: number | null;
  coreOI: number | null;
  cse: number | null;
  noa: number | null;
  cfo: number | null;
  nfo: number | null;
}

/** Subsidiary contribution for one period (consolidated − standalone) */
export interface SubsidiaryContribution {
  period_end: string;

  // Absolute contribution (₹ Crore)
  salesContribution: number | null;
  patContribution: number | null;
  coreOIContribution: number | null;
  cseContribution: number | null;
  noaContribution: number | null;
  cfoContribution: number | null;

  // As % of consolidated (0–1 scale)
  salesContributionPct: number | null;
  patContributionPct: number | null;
  coreOIContributionPct: number | null;
  cseContributionPct: number | null;
  noaContributionPct: number | null;
  cfoContributionPct: number | null;

  /** Whether this period has both consolidated and standalone data */
  bothAvailable: boolean;
}

/** Summary statistics across all aligned periods */
export interface SubsidiaryContributionSummary {
  /** Number of periods with both consolidated and standalone data */
  alignedPeriods: number;
  /** Median subsidiary PAT contribution as % of consolidated */
  medianPatContributionPct: number | null;
  /** Median subsidiary Sales contribution as % of consolidated */
  medianSalesContributionPct: number | null;
  /** Median subsidiary CoreOI contribution as % of consolidated */
  medianCoreOIContributionPct: number | null;
  /** Median subsidiary NOA contribution as % of consolidated */
  medianNOAContributionPct: number | null;
  /** Latest period subsidiary contribution */
  latest: SubsidiaryContribution | null;
  /** Trend: is subsidiary contribution growing? */
  patContributionTrend: "growing" | "stable" | "shrinking" | "insufficient-data";
}

export interface ScopeAwareResult {
  /** Full pipeline result for consolidated data */
  consolidated: PipelineResult;
  /** Full pipeline result for standalone data (null if not provided) */
  standalone: PipelineResult | null;
  /** Per-period subsidiary contribution analysis */
  subsidiaryContribution: SubsidiaryContribution[];
  /** Summary statistics */
  summary: SubsidiaryContributionSummary;
  /** Periods present in consolidated but not standalone */
  consolidatedOnlyPeriods: string[];
  /** Periods present in standalone but not consolidated */
  standaloneOnlyPeriods: string[];
  /** Whether scope-aware analysis was possible */
  scopeAwareAnalysisAvailable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractMetrics(period: RecastPeriod): ScopeMetricSnapshot {
  return {
    period_end: period.period_end,
    sales:   period.is?.Sales  ?? null,
    pat:     period.is?.PAT    ?? null,
    coreOI:  period.cu?.CoreOI ?? null,
    cse:     period.bs?.CSE    ?? null,
    noa:     period.bs?.NOA    ?? null,
    cfo:     period.cf?.CFO    ?? null,
    nfo:     period.bs?.NFO    ?? null,
  };
}

function safeDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a - b;
}

/**
 * Compute contribution as a fraction of consolidated. Returns null when:
 *   - either operand is null/missing
 *   - consolidated is exactly zero (avoid division by zero)
 *   - consolidated is negative — a "subsidiary contribution %" is only meaningful
 *     when the consolidated denominator is positive. For a loss year (PAT
 *     consolidated = −500, standalone = −300, diff = −200), pct = −200/−500 = 0.40
 *     would read as "subs contributed 40%" which is misleading (review W4).
 *     Callers should treat null here as "denominator was non-positive — see
 *     absolute contribution instead".
 */
function safePct(contribution: number | null, consolidated: number | null): number | null {
  if (contribution == null || consolidated == null) return null;
  if (consolidated <= 0) return null;
  return contribution / consolidated;
}

function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Estimate trend direction from a series of percentages. Uses a least-squares
 * slope rather than first-half vs second-half averages so a single recent
 * outlier doesn't read as a sustained trend (review W5).
 *
 * Threshold: slope * length is the implied total change across the window;
 * we declare "growing"/"shrinking" when that exceeds 2pp.
 */
function computeTrend(values: Array<number | null>): SubsidiaryContributionSummary["patContributionTrend"] {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length < 3) return "insufficient-data";

  const n = clean.length;
  const meanX = (n - 1) / 2;                                     // x = 0..n-1
  const meanY = clean.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov  += (i - meanX) * (clean[i] - meanY);
    varX += (i - meanX) ** 2;
  }
  if (varX === 0) return "stable";
  const slope = cov / varX;
  const totalChange = slope * (n - 1); // implied change from first to last period

  if (totalChange > 0.02)  return "growing";
  if (totalChange < -0.02) return "shrinking";
  return "stable";
}

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Process consolidated and standalone data together.
 *
 * @param consolidatedData  RawPeriodData[] from consolidated Capitaline export
 * @param standaloneData    RawPeriodData[] from standalone Capitaline export (optional)
 * @param config            Engine config
 */
export function processScopeAwareData(
  consolidatedData: RawPeriodData[],
  standaloneData: RawPeriodData[] | null,
  config: EngineConfig,
): ScopeAwareResult {
  // ── 1. Run both through the pipeline ────────────────────────────────────
  const consolidatedResult = processCompanyDataFull(consolidatedData, config);

  const standaloneResult = standaloneData && standaloneData.length > 0
    ? processCompanyDataFull(standaloneData, config)
    : null;

  if (!standaloneResult) {
    return {
      consolidated: consolidatedResult,
      standalone: null,
      subsidiaryContribution: [],
      summary: {
        alignedPeriods: 0,
        medianPatContributionPct: null,
        medianSalesContributionPct: null,
        medianCoreOIContributionPct: null,
        medianNOAContributionPct: null,
        latest: null,
        patContributionTrend: "insufficient-data",
      },
      consolidatedOnlyPeriods: consolidatedResult.periods.map(p => p.period_end),
      standaloneOnlyPeriods: [],
      scopeAwareAnalysisAvailable: false,
    };
  }

  // ── 2. Build period maps ─────────────────────────────────────────────────
  const consolidatedMap = new Map<string, ScopeMetricSnapshot>(
    consolidatedResult.periods.map(p => [p.period_end, extractMetrics(p)])
  );
  const standaloneMap = new Map<string, ScopeMetricSnapshot>(
    standaloneResult.periods.map(p => [p.period_end, extractMetrics(p)])
  );

  const consolidatedPeriods = new Set(consolidatedMap.keys());
  const standalonePeriods   = new Set(standaloneMap.keys());

  const consolidatedOnlyPeriods = Array.from(consolidatedPeriods).filter(p => !standalonePeriods.has(p));
  const standaloneOnlyPeriods   = Array.from(standalonePeriods).filter(p => !consolidatedPeriods.has(p));

  // ── 3. Compute contribution for aligned periods ──────────────────────────
  // Sort by parsed date rather than alphabetical string compare. ISO-8601
  // (YYYY-MM-DD) sorts correctly alphabetically, but if the parser ever ships
  // quarterly data as "Q1 FY25" or "31-03-2024" the alphabetical sort would
  // pick the wrong "latest" period (review W6).
  const alignedPeriods = Array.from(consolidatedPeriods)
    .filter(p => standalonePeriods.has(p))
    .sort((a, b) => {
      const ta = new Date(a).getTime();
      const tb = new Date(b).getTime();
      // Fall back to lexical comparison only when both dates parse as NaN
      // (preserves stable order for non-date period labels).
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a.localeCompare(b);
      if (Number.isNaN(ta)) return -1;
      if (Number.isNaN(tb)) return 1;
      return ta - tb;
    });

  const contributions: SubsidiaryContribution[] = [];

  for (const period_end of alignedPeriods) {
    const cons = consolidatedMap.get(period_end)!;
    const stan = standaloneMap.get(period_end)!;

    const salesContribution  = safeDiff(cons.sales,  stan.sales);
    const patContribution    = safeDiff(cons.pat,    stan.pat);
    const coreOIContribution = safeDiff(cons.coreOI, stan.coreOI);
    const cseContribution    = safeDiff(cons.cse,    stan.cse);
    const noaContribution    = safeDiff(cons.noa,    stan.noa);
    const cfoContribution    = safeDiff(cons.cfo,    stan.cfo);

    contributions.push({
      period_end,
      salesContribution,
      patContribution,
      coreOIContribution,
      cseContribution,
      noaContribution,
      cfoContribution,
      salesContributionPct:  safePct(salesContribution,  cons.sales),
      patContributionPct:    safePct(patContribution,    cons.pat),
      coreOIContributionPct: safePct(coreOIContribution, cons.coreOI),
      cseContributionPct:    safePct(cseContribution,    cons.cse),
      noaContributionPct:    safePct(noaContribution,    cons.noa),
      cfoContributionPct:    safePct(cfoContribution,    cons.cfo),
      bothAvailable: true,
    });
  }

  // ── 4. Summary statistics ────────────────────────────────────────────────
  const patPcts    = contributions.map(c => c.patContributionPct).filter((v): v is number => v != null);
  const salesPcts  = contributions.map(c => c.salesContributionPct).filter((v): v is number => v != null);
  const coreOIPcts = contributions.map(c => c.coreOIContributionPct).filter((v): v is number => v != null);
  const noaPcts    = contributions.map(c => c.noaContributionPct).filter((v): v is number => v != null);

  const summary: SubsidiaryContributionSummary = {
    alignedPeriods: alignedPeriods.length,
    medianPatContributionPct:    medianOf(patPcts),
    medianSalesContributionPct:  medianOf(salesPcts),
    medianCoreOIContributionPct: medianOf(coreOIPcts),
    medianNOAContributionPct:    medianOf(noaPcts),
    latest: contributions.length > 0 ? contributions[contributions.length - 1] : null,
    patContributionTrend: computeTrend(contributions.map(c => c.patContributionPct)),
  };

  return {
    consolidated: consolidatedResult,
    standalone: standaloneResult,
    subsidiaryContribution: contributions,
    summary,
    consolidatedOnlyPeriods,
    standaloneOnlyPeriods,
    scopeAwareAnalysisAvailable: alignedPeriods.length > 0,
  };
}

// ─── Utility: SOTP Validation ─────────────────────────────────────────────────

/**
 * Validate SOTP segment sum against the consolidated-standalone gap.
 *
 * If SOTP assigns value to subsidiaries, that value should be consistent
 * with the actual subsidiary contribution observed in the financials.
 *
 * Returns a validation note for the SOTP report.
 */
export function validateSOTPAgainstSubsidiaryContribution(
  sotpSubsidiaryValuePct: number | null,  // % of total SOTP value attributed to subsidiaries
  summary: SubsidiaryContributionSummary,
): {
  consistent: boolean;
  note: string;
  gap: number | null;
} {
  if (sotpSubsidiaryValuePct == null || summary.medianPatContributionPct == null) {
    return {
      consistent: true,
      note: "Insufficient data for SOTP-subsidiary validation",
      gap: null,
    };
  }

  const gap = Math.abs(sotpSubsidiaryValuePct - summary.medianPatContributionPct);
  const consistent = gap < 0.20; // within 20 percentage points

  const note = consistent
    ? `SOTP subsidiary allocation (${(sotpSubsidiaryValuePct * 100).toFixed(1)}%) is consistent with observed subsidiary PAT contribution (${(summary.medianPatContributionPct * 100).toFixed(1)}%)`
    : `SOTP subsidiary allocation (${(sotpSubsidiaryValuePct * 100).toFixed(1)}%) diverges from observed subsidiary PAT contribution (${(summary.medianPatContributionPct * 100).toFixed(1)}%) by ${(gap * 100).toFixed(1)}pp — review segment assumptions`;

  return { consistent, note, gap };
}
