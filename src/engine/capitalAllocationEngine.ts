/**
 * Capital Allocation & Conglomerate Discount Engine
 *
 * Measures how well management deploys capital across segments,
 * and quantifies conglomerate discount/premium vs pure-play peers.
 *
 * Three analyses:
 *   1. Capital Allocation Efficiency — incremental ROIC per segment
 *   2. Conglomerate Discount — Berger-Ofek sum-of-parts methodology
 *   3. Transfer Pricing Distortion Detection
 *
 * Academic basis:
 *   - Berger & Ofek (1995): Diversification's effect on firm value
 *   - Rajan, Servaes & Zingales (2000): Cost of diversity
 *   - Penman (2013): Segment analysis for valuation
 */

import type { SegmentData } from "./segmentParser";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CapitalAllocationResult {
  segments: SegmentAllocationEntry[];
  firmLevel: {
    overallROIC: number;
    capitalEfficiencyScore: number;    // 0-100
    allocationQuality: "excellent" | "good" | "poor" | "value_destructive";
    totalCapitalMisallocated: number;  // % of capital in below-CoC segments
  };
  recommendation: string;
}

export interface SegmentAllocationEntry {
  name: string;
  capitalDeployed: number;        // net assets
  capitalShare: number;           // % of total
  roic: number;                   // segment ROIC (after-tax)
  spreadVsCOC: number;            // ROIC - cost of capital
  incrementalROIC: number | null; // Δprofit / Δcapital (3Y)
  economicProfit: number;         // (ROIC - r) × capital
  verdict: "star" | "cash_cow" | "turnaround" | "divest";
  capitalAction: "increase" | "maintain" | "harvest" | "divest";
}

export interface ConglomerateDiscountResult {
  // Core measurement
  impliedSOTPValue: number;       // sum of segment values at peer multiples
  marketCap: number;
  discountPremium: number;        // (SOTP - marketCap) / SOTP, positive = discount
  discountPct: number;            // as percentage

  // Segment valuations
  segmentValues: Array<{
    name: string;
    assets: number;
    peerPB: number;               // peer sector P/B multiple
    impliedValue: number;         // assets × peerPB
    shareOfSOTP: number;
  }>;

  // Interpretation
  verdict: "deep_discount" | "discount" | "fair" | "premium";
  catalyst: string;               // what could unlock value
  narrative: string;
}

export interface TransferPricingFlag {
  segment: string;
  flag: string;
  severity: "info" | "warning" | "critical";
  interSegmentRevenuePct: number;
  marginVsPeer: number | null;    // segment OPM vs sector median
}

// ─── Sector P/B Multiples (Indian listed company medians) ──────────────────

const SECTOR_PB_MULTIPLES: Record<string, number> = {
  "it-services": 8.0,
  "consumer": 12.0,
  "fmcg": 14.0,
  "pharma": 5.0,
  "bank": 2.5,
  "insurance": 3.5,
  "nbfc": 2.8,
  "infrastructure": 2.0,
  "industrial": 3.5,
  "metals": 1.8,
  "telecom": 3.0,
  "real-estate": 1.5,
  "financial-services": 3.0,
  "development-projects": 1.2,
  "hydrocarbon": 1.5,
  "power": 2.0,
  "defence": 5.0,
  "default": 2.5,
};

const SECTOR_OPM_MEDIANS: Record<string, number> = {
  "it-services": 0.22,
  "consumer": 0.15,
  "fmcg": 0.18,
  "infrastructure": 0.08,
  "industrial": 0.12,
  "metals": 0.10,
  "financial-services": 0.35,
  "hydrocarbon": 0.12,
  "default": 0.12,
};

// ─── Capital Allocation ────────────────────────────────────────────────────

export function analyzeCapitalAllocation(
  segmentData: SegmentData,
  costOfCapital: number,
  taxRate: number = 0.25,
): CapitalAllocationResult | null {
  const { segments, years, data } = segmentData;
  if (segments.length < 2 || years.length < 2) return null;

  const latestYear = years[0];
  const thirdYear = years[2] || years[years.length - 1];

  let totalCapital = 0;
  let totalProfit = 0;
  const entries: SegmentAllocationEntry[] = [];

  for (const segName of segments) {
    const d = data[segName]?.[latestYear];
    if (!d || d.assets == null) continue;

    const capital = (d.assets ?? 0) - (d.liabilities ?? 0);
    if (capital <= 0) continue;

    const profit = (d.result ?? 0) * (1 - taxRate);
    const roic = profit / capital;
    const spread = roic - costOfCapital;
    const economicProfit = spread * capital;

    // Incremental ROIC (3Y)
    let incrementalROIC: number | null = null;
    const dThird = data[segName]?.[thirdYear];
    if (dThird && dThird.assets != null) {
      const prevCapital = (dThird.assets ?? 0) - (dThird.liabilities ?? 0);
      const prevProfit = (dThird.result ?? 0) * (1 - taxRate);
      const deltaCapital = capital - prevCapital;
      const deltaProfit = profit - prevProfit;
      if (Math.abs(deltaCapital) > 100) {
        incrementalROIC = deltaProfit / deltaCapital;
      }
    }

    totalCapital += capital;
    totalProfit += profit;

    entries.push({
      name: segName,
      capitalDeployed: capital,
      capitalShare: 0, // filled below
      roic,
      spreadVsCOC: spread,
      incrementalROIC,
      economicProfit,
      verdict: "cash_cow",
      capitalAction: "maintain",
    });
  }

  if (entries.length === 0) return null;

  // Fill shares and classify
  let misallocatedPct = 0;
  for (const e of entries) {
    e.capitalShare = totalCapital > 0 ? e.capitalDeployed / totalCapital : 0;

    // Verdict
    if (e.spreadVsCOC > 0.05 && (e.incrementalROIC ?? e.roic) > costOfCapital) {
      e.verdict = "star";
      e.capitalAction = "increase";
    } else if (e.spreadVsCOC > 0 && (e.incrementalROIC ?? e.roic) <= costOfCapital) {
      e.verdict = "cash_cow";
      e.capitalAction = "maintain";
    } else if (e.spreadVsCOC < 0 && (e.incrementalROIC ?? 0) > 0) {
      e.verdict = "turnaround";
      e.capitalAction = "harvest";
    } else {
      e.verdict = "divest";
      e.capitalAction = "divest";
      misallocatedPct += e.capitalShare;
    }
  }

  // Firm-level
  const overallROIC = totalCapital > 0 ? totalProfit / totalCapital : 0;
  const starCount = entries.filter(e => e.verdict === "star").length;

  let score: number;
  if (misallocatedPct < 0.10 && starCount > 0) score = 85 + (starCount / entries.length) * 15;
  else if (misallocatedPct < 0.25) score = 60 + (1 - misallocatedPct) * 25;
  else score = Math.max(10, 50 * (1 - misallocatedPct));

  let quality: CapitalAllocationResult["firmLevel"]["allocationQuality"];
  if (score >= 80) quality = "excellent";
  else if (score >= 60) quality = "good";
  else if (score >= 40) quality = "poor";
  else quality = "value_destructive";

  // Recommendation
  const starsToIncrease = entries.filter(e => e.capitalAction === "increase").map(e => e.name);
  const toDivest = entries.filter(e => e.capitalAction === "divest").map(e => e.name);
  let recommendation = "";
  if (starsToIncrease.length > 0) {
    recommendation += `Increase allocation to: ${starsToIncrease.join(", ")}. `;
  }
  if (toDivest.length > 0) {
    recommendation += `Consider divesting: ${toDivest.join(", ")}. `;
  }
  if (recommendation === "") recommendation = "Capital allocation is balanced — no major reallocation needed.";

  return {
    segments: entries,
    firmLevel: {
      overallROIC,
      capitalEfficiencyScore: Math.round(score),
      allocationQuality: quality,
      totalCapitalMisallocated: misallocatedPct,
    },
    recommendation,
  };
}

// ─── Conglomerate Discount ─────────────────────────────────────────────────

/**
 * Measure conglomerate discount using Berger-Ofek methodology.
 * Each segment valued at peer sector P/B multiple.
 */
export function measureConglomerateDiscount(
  segmentData: SegmentData,
  marketPricePerShare: number,
  sharesOutstanding: number,
  segmentSectorMap?: Record<string, string>, // segment name → sector key
): ConglomerateDiscountResult | null {
  const { segments, years, data } = segmentData;
  if (segments.length < 2 || years.length === 0) return null;

  const latestYear = years[0];
  const marketCap = marketPricePerShare * sharesOutstanding;
  if (marketCap <= 0) return null;

  const segmentValues: ConglomerateDiscountResult["segmentValues"] = [];
  let totalSOTP = 0;

  for (const segName of segments) {
    const d = data[segName]?.[latestYear];
    if (!d || d.assets == null) continue;

    const netAssets = (d.assets ?? 0) - (d.liabilities ?? 0);
    if (netAssets <= 0) continue;

    // Determine sector for this segment
    const sectorKey = segmentSectorMap?.[segName] ?? inferSectorFromName(segName);
    const peerPB = SECTOR_PB_MULTIPLES[sectorKey] ?? SECTOR_PB_MULTIPLES["default"];

    const impliedValue = netAssets * peerPB;
    totalSOTP += impliedValue;

    segmentValues.push({
      name: segName,
      assets: netAssets,
      peerPB,
      impliedValue,
      shareOfSOTP: 0,
    });
  }

  if (totalSOTP <= 0) return null;

  // Fill shares
  for (const sv of segmentValues) {
    sv.shareOfSOTP = sv.impliedValue / totalSOTP;
  }

  const discountPremium = (totalSOTP - marketCap) / totalSOTP;
  const discountPct = discountPremium * 100;

  let verdict: ConglomerateDiscountResult["verdict"];
  if (discountPct > 25) verdict = "deep_discount";
  else if (discountPct > 10) verdict = "discount";
  else if (discountPct > -10) verdict = "fair";
  else verdict = "premium";

  // Catalyst identification
  let catalyst: string;
  if (verdict === "deep_discount" || verdict === "discount") {
    const largest = [...segmentValues].sort((a, b) => b.impliedValue - a.impliedValue)[0];
    catalyst = `Demerger/spin-off of ${largest?.name ?? "largest segment"} could unlock ~${discountPct.toFixed(0)}% discount. Alternatively, improved capital allocation or share buybacks.`;
  } else {
    catalyst = "Trading near or above SOTP — no structural discount to unlock.";
  }

  const narrative = `SOTP: ₹${(totalSOTP / sharesOutstanding).toFixed(0)}/share vs market ₹${marketPricePerShare.toFixed(0)}. ` +
    `${verdict === "deep_discount" || verdict === "discount" ? `${discountPct.toFixed(0)}% conglomerate discount` : verdict === "premium" ? `${(-discountPct).toFixed(0)}% conglomerate premium` : "Near fair value"}.`;

  return {
    impliedSOTPValue: totalSOTP / sharesOutstanding,
    marketCap,
    discountPremium,
    discountPct,
    segmentValues,
    verdict,
    catalyst,
    narrative,
  };
}

// ─── Transfer Pricing Detection ────────────────────────────────────────────

export function detectTransferPricingDistortion(
  segmentData: SegmentData,
  segmentSectorMap?: Record<string, string>,
): TransferPricingFlag[] {
  const { segments, years, data } = segmentData;
  if (segments.length < 2 || years.length === 0) return [];

  const latestYear = years[0];
  const flags: TransferPricingFlag[] = [];

  for (const segName of segments) {
    const d = data[segName]?.[latestYear];
    if (!d) continue;

    const revenue = d.revenue ?? 0;
    const interSeg = d.interSegmentRevenue ?? 0;
    const result = d.result ?? 0;

    if (revenue <= 0) continue;

    const interSegPct = Math.abs(interSeg) / revenue;
    const opm = result / revenue;

    // Flag 1: High inter-segment revenue
    if (interSegPct > 0.10) {
      flags.push({
        segment: segName,
        flag: `${(interSegPct * 100).toFixed(1)}% of revenue is inter-segment — pricing may be non-arm's-length`,
        severity: interSegPct > 0.25 ? "critical" : "warning",
        interSegmentRevenuePct: interSegPct,
        marginVsPeer: null,
      });
    }

    // Flag 2: Margin divergence from peer
    const sectorKey = segmentSectorMap?.[segName] ?? inferSectorFromName(segName);
    const peerOPM = SECTOR_OPM_MEDIANS[sectorKey] ?? SECTOR_OPM_MEDIANS["default"];
    const marginDiff = opm - peerOPM;

    if (Math.abs(marginDiff) > 0.10) {
      const direction = marginDiff > 0 ? "above" : "below";
      flags.push({
        segment: segName,
        flag: `OPM ${(opm * 100).toFixed(1)}% is ${(Math.abs(marginDiff) * 100).toFixed(0)}pp ${direction} sector median (${(peerOPM * 100).toFixed(1)}%) — possible margin transfer`,
        severity: Math.abs(marginDiff) > 0.15 ? "warning" : "info",
        interSegmentRevenuePct: interSegPct,
        marginVsPeer: marginDiff,
      });
    }
  }

  // Flag 3: Suspiciously uniform margins across all segments
  const opms = segments
    .map(s => {
      const d = data[s]?.[latestYear];
      if (!d || !d.revenue || d.revenue === 0) return null;
      return (d.result ?? 0) / d.revenue;
    })
    .filter((v): v is number => v != null);

  if (opms.length >= 3) {
    const mean = opms.reduce((s, v) => s + v, 0) / opms.length;
    const std = Math.sqrt(opms.reduce((s, v) => s + (v - mean) ** 2, 0) / opms.length);
    const cv = mean !== 0 ? std / Math.abs(mean) : 1;
    if (cv < 0.15 && opms.length >= 4) {
      flags.push({
        segment: "ALL",
        flag: `Suspiciously uniform margins across ${opms.length} segments (CV=${(cv * 100).toFixed(0)}%) — possible artificial smoothing`,
        severity: "warning",
        interSegmentRevenuePct: 0,
        marginVsPeer: null,
      });
    }
  }

  return flags;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function inferSectorFromName(segName: string): string {
  const lower = segName.toLowerCase();
  if (lower.includes("it") || lower.includes("technology") || lower.includes("digital")) return "it-services";
  if (lower.includes("infra") || lower.includes("construction") || lower.includes("engineering")) return "infrastructure";
  if (lower.includes("financ") || lower.includes("lending") || lower.includes("insurance")) return "financial-services";
  if (lower.includes("metal") || lower.includes("steel") || lower.includes("mining")) return "metals";
  if (lower.includes("hydrocarbon") || lower.includes("oil") || lower.includes("gas")) return "hydrocarbon";
  if (lower.includes("power") || lower.includes("energy")) return "power";
  if (lower.includes("pharma") || lower.includes("health")) return "pharma";
  if (lower.includes("defence") || lower.includes("defense")) return "defence";
  if (lower.includes("consumer") || lower.includes("fmcg") || lower.includes("retail")) return "consumer";
  if (lower.includes("telecom") || lower.includes("communication")) return "telecom";
  if (lower.includes("real") || lower.includes("property") || lower.includes("development")) return "development-projects";
  return "default";
}
