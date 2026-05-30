/**
 * Segment RNOA Decomposition Engine
 *
 * Decomposes segment-level returns into Margin × Turnover, classifies
 * lifecycle stage, computes segment residual income, and identifies
 * capital misallocation.
 *
 * Academic basis:
 *   - Penman (2013) Ch. 12: RNOA = OPM × ATO at segment level
 *   - Nissim & Penman (2001): ratio analysis and equity valuation
 */

import type { SegmentData } from "./segmentParser";

// ─── Types ─────────────────────────────────────────────────────────────────

export type SegmentLifecycle = "startup" | "growth" | "mature" | "decline";
export type SegmentQuadrant = "star" | "margin_fortress" | "volume_play" | "dog";
export type TrendDirection = "improving" | "stable" | "deteriorating";

export interface SegmentRNOAEntry {
  name: string;
  // Raw data (latest year)
  revenue: number;
  result: number;        // segment EBIT
  assets: number;
  liabilities: number;
  netAssets: number;     // assets - liabilities
  capex: number;
  depreciation: number;

  // Decomposition
  opm: number;           // operating profit margin = result / revenue
  ato: number;           // asset turnover = revenue / netAssets
  rnoa: number;          // return on net operating assets = result / netAssets (= opm × ato)

  // Residual income
  reoi: number;          // segment residual operating income
  capitalCharge: number; // r_F × netAssets

  // Classification
  quadrant: SegmentQuadrant;
  lifecycle: SegmentLifecycle;
  trend: TrendDirection;

  // Contribution to firm
  revenueShare: number;  // % of total revenue
  profitShare: number;   // % of total result
  capitalShare: number;  // % of total net assets
  rnoaContribution: number; // capital-weighted RNOA contribution to firm

  // Capital efficiency
  reinvestmentRate: number; // capex / depreciation
  marginalProductivity: number | null; // Δ result / Δ capital (3Y)
}

export interface SegmentRNOADecomposition {
  latestYear: string;
  segments: SegmentRNOAEntry[];

  firmLevel: {
    totalRevenue: number;
    totalResult: number;
    totalNetAssets: number;
    rnoa: number;
    weightedOPM: number;
    weightedATO: number;
    capitalMisallocation: number; // RNOA lost by over-allocating to dogs
  };

  // What-if: optimal reallocation
  optimalAllocation: {
    potentialRNOA: number;
    rnoaGain: number;
    narrative: string;
  };

  // Value creation split
  valueCreation: {
    valueCreatingSegments: string[];
    valueDestroyingSegments: string[];
    netEconomicProfit: number; // Σ segment ReOI
  };
}

// ─── Core Implementation ───────────────────────────────────────────────────

/**
 * Full segment RNOA decomposition.
 */
export function decomposeSegmentRNOA(
  segmentData: SegmentData,
  costOfCapital: number,
  taxRate: number = 0.25,
): SegmentRNOADecomposition | null {
  // NaN guards — non-finite inputs would poison capital charge calculations
  // for every segment. Fail closed when costOfCapital is invalid; clamp tax.
  if (!Number.isFinite(costOfCapital) || costOfCapital < 0) return null;
  if (!Number.isFinite(taxRate)) taxRate = 0.25;

  const { segments, years, data } = segmentData;
  if (segments.length === 0 || years.length === 0) return null;

  const latestYear = years[0]!; // newest first in Capitaline
  const thirdYear = years[2] || null;

  // Build entries for segments with valid data in latest year
  const entries: SegmentRNOAEntry[] = [];
  let totalRevenue = 0;
  let totalResult = 0;
  let totalNetAssets = 0;

  for (const segName of segments) {
    const d = data[segName]?.[latestYear];
    if (!d) continue;

    const revenue = d.revenue ?? 0;
    const result = d.result ?? 0;
    const assets = d.assets ?? 0;
    const liabilities = d.liabilities ?? 0;
    const capex = d.capex ?? 0;
    const depreciation = d.depreciation ?? 0;

    // Skip segments with no meaningful data
    if (revenue === 0 && result === 0 && assets === 0) continue;

    const netAssets = assets - liabilities;

    totalRevenue += revenue;
    totalResult += result;
    totalNetAssets += netAssets;

    entries.push({
      name: segName,
      revenue, result, assets, liabilities, netAssets, capex, depreciation,
      opm: 0, ato: 0, rnoa: 0, reoi: 0, capitalCharge: 0,
      quadrant: "dog", lifecycle: "mature", trend: "stable",
      revenueShare: 0, profitShare: 0, capitalShare: 0, rnoaContribution: 0,
      reinvestmentRate: 0, marginalProductivity: null,
    });
  }

  if (entries.length === 0) return null;

  // Compute decomposition for each segment
  for (const e of entries) {
    // Core ratios
    e.opm = e.revenue !== 0 ? e.result / e.revenue : 0;
    e.ato = e.netAssets !== 0 ? e.revenue / e.netAssets : 0;
    e.rnoa = e.netAssets !== 0 ? e.result / e.netAssets : 0;

    // Residual income (post-tax)
    e.capitalCharge = costOfCapital * Math.max(0, e.netAssets);
    e.reoi = e.result * (1 - taxRate) - e.capitalCharge;

    // Shares
    e.revenueShare = totalRevenue !== 0 ? e.revenue / totalRevenue : 0;
    e.profitShare = totalResult !== 0 ? e.result / totalResult : 0;
    e.capitalShare = totalNetAssets !== 0 ? e.netAssets / totalNetAssets : 0;
    e.rnoaContribution = e.capitalShare * e.rnoa;

    // Reinvestment
    e.reinvestmentRate = e.depreciation !== 0 ? e.capex / e.depreciation : 1;

    // Quadrant classification
    const highOPM = e.opm > 0.15;
    const highATO = e.ato > 1.5;
    if (highOPM && highATO) e.quadrant = "star";
    else if (highOPM && !highATO) e.quadrant = "margin_fortress";
    else if (!highOPM && highATO) e.quadrant = "volume_play";
    else e.quadrant = "dog";

    // Lifecycle classification
    e.lifecycle = classifyLifecycle(e.name, data, years, latestYear, thirdYear, e);

    // Trend (3Y RNOA direction)
    e.trend = computeTrend(e.name, data, years);

    // Marginal capital productivity (3Y)
    e.marginalProductivity = computeMarginalProductivity(e.name, data, years, thirdYear);
  }

  // Firm-level aggregation
  const firmRNOA = totalNetAssets !== 0 ? totalResult / totalNetAssets : 0;
  const weightedOPM = totalRevenue !== 0 ? totalResult / totalRevenue : 0;
  const weightedATO = totalNetAssets !== 0 ? totalRevenue / totalNetAssets : 0;

  // Capital misallocation: how much RNOA lost by over-allocating to below-average segments
  const avgRNOA = firmRNOA;
  let misallocation = 0;
  for (const e of entries) {
    if (e.rnoa < avgRNOA && e.capitalShare > 0) {
      // Capital in this segment × (firm avg - segment RNOA) = wasted return
      misallocation += e.capitalShare * (avgRNOA - e.rnoa);
    }
  }

  // Optimal allocation: if all capital went to highest-RNOA segments
  const sorted = [...entries].sort((a, b) => b.rnoa - a.rnoa);
  const bestRNOA = sorted[0]?.rnoa ?? 0;
  const potentialRNOA = Math.min(bestRNOA, firmRNOA * 2); // cap at 2× to be realistic
  const rnoaGain = potentialRNOA - firmRNOA;

  const bestSegments = sorted.filter(e => e.rnoa > costOfCapital).map(e => e.name);
  const narrative = rnoaGain > 0.02
    ? `Reallocating capital toward ${bestSegments.slice(0, 2).join(", ")} could lift RNOA by ~${(rnoaGain * 100).toFixed(1)}pp`
    : "Capital allocation is near-optimal — no significant RNOA improvement available from reallocation";

  // Value creation split
  const valueCreating = entries.filter(e => e.reoi > 0).map(e => e.name);
  const valueDestroying = entries.filter(e => e.reoi < 0).map(e => e.name);
  const netEconomicProfit = entries.reduce((s, e) => s + e.reoi, 0);

  return {
    latestYear,
    segments: entries,
    firmLevel: {
      totalRevenue,
      totalResult,
      totalNetAssets,
      rnoa: firmRNOA,
      weightedOPM,
      weightedATO,
      capitalMisallocation: misallocation,
    },
    optimalAllocation: { potentialRNOA, rnoaGain, narrative },
    valueCreation: {
      valueCreatingSegments: valueCreating,
      valueDestroyingSegments: valueDestroying,
      netEconomicProfit,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function classifyLifecycle(
  segName: string,
  data: SegmentData["data"],
  years: string[],
  _latestYear: string,
  thirdYear: string | null,
  entry: SegmentRNOAEntry,
): SegmentLifecycle {
  const latestRev = entry.revenue;
  const thirdRev = thirdYear ? (data[segName]?.[thirdYear]?.revenue ?? 0) : 0;
  const revCagr3y = thirdRev > 0 && latestRev > 0
    ? Math.pow(latestRev / thirdRev, 1 / 3) - 1
    : 0;

  const reOIPositive = entry.result > 0;
  const reinvestmentHigh = entry.reinvestmentRate > 1.5;

  if (!reOIPositive && revCagr3y > 0.20) return "startup";
  if (reOIPositive && revCagr3y > 0.15 && reinvestmentHigh) return "growth";
  if (revCagr3y < -0.05) return "decline";
  // Check for 3 straight years of declining result
  if (years.length >= 3) {
    const r0 = data[segName]?.[years[0]!]?.result ?? 0;
    const r1 = data[segName]?.[years[1]!]?.result ?? 0;
    const r2 = data[segName]?.[years[2]!]?.result ?? 0;
    if (r0 < r1 && r1 < r2 && r0 < 0) return "decline";
  }
  return "mature";
}

function computeTrend(
  segName: string,
  data: SegmentData["data"],
  years: string[],
): TrendDirection {
  if (years.length < 3) return "stable";

  const rnoas: number[] = [];
  for (let i = 0; i < Math.min(3, years.length); i++) {
    const d = data[segName]?.[years[i]!];
    if (!d || d.result == null || d.assets == null) break;
    const na = (d.assets ?? 0) - (d.liabilities ?? 0);
    if (na > 0) rnoas.push(d.result / na);
  }

  if (rnoas.length < 3) return "stable";

  // rnoas[0] = latest, rnoas[2] = oldest
  const delta = rnoas[0]! - rnoas[2]!;
  if (delta > 0.03) return "improving";
  if (delta < -0.03) return "deteriorating";
  return "stable";
}

function computeMarginalProductivity(
  segName: string,
  data: SegmentData["data"],
  years: string[],
  thirdYear: string | null,
): number | null {
  if (!thirdYear || years.length < 3) return null;

  const latest = data[segName]?.[years[0]!];
  const third = data[segName]?.[thirdYear];
  if (!latest || !third) return null;

  const deltaResult = (latest.result ?? 0) - (third.result ?? 0);
  const latestNA = (latest.assets ?? 0) - (latest.liabilities ?? 0);
  const thirdNA = (third.assets ?? 0) - (third.liabilities ?? 0);
  const deltaCapital = latestNA - thirdNA;

  if (Math.abs(deltaCapital) < 100) return null; // too small to be meaningful
  return deltaResult / deltaCapital;
}
