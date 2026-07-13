import type { BankPeriodMetrics } from "../bankPipeline/metrics";
import type {
  CreditCostCycleCheck,
  SpreadCompressionCheck,
  EclStressGovernorResult,
} from "./types";
import {
  NBFC_ECL_STRESS_WARNING_PCT,
  NBFC_ECL_STRESS_MID_PCT,
  NBFC_ECL_STRESS_DISTRESS_PCT,
  NBFC_ECL_STRESS_MID_FACTOR,
  NBFC_ECL_STRESS_MIN_FACTOR,
  median,
} from "./shared";

// ── Lens 7: Through-cycle credit-cost band ──────────────────────────────────

/**
 * Compares latest credit cost to trailing-7y median. NBFCs are pro-cyclical:
 * peaks in FY18 (IL&FS), FY20 (Covid). When latest << median, flag as
 * under-provisioning (the analyst should ask: is this normalisation, or
 * are we at the bottom of a credit cycle being released as profit?).
 */
export function creditCostCycle(metrics: BankPeriodMetrics[]): CreditCostCycleCheck {
  const series = metrics
    .slice(-7)
    .map(m => m.creditCost)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  if (series.length < 4) {
    return {
      status: "skipped",
      medianCreditCost: null,
      latestCreditCost: null,
      ratio: null,
      severity: "unknown",
      message: `only ${series.length} usable periods of credit cost (need ≥4)`,
    };
  }
  const med = median(series);
  const latest = metrics[metrics.length - 1]!.creditCost;
  if (med == null || latest == null) {
    return {
      status: "skipped",
      medianCreditCost: med,
      latestCreditCost: latest,
      ratio: null,
      severity: "unknown",
      message: "median or latest credit cost null after filter",
    };
  }
  const ratio = med > 0 ? latest / med : null;
  let severity: CreditCostCycleCheck["severity"] = "normal";
  let message: string;
  if (ratio == null) {
    severity = "unknown";
    message = "median credit cost zero — cannot compute ratio";
  } else if (ratio < 0.6) {
    severity = "under-provisioning";
    message = `latest credit cost ${(latest * 100).toFixed(2)}% is ${(ratio * 100).toFixed(0)}% of trailing 7y median (${(med * 100).toFixed(2)}%) — possibly cycle-bottom release; valuation may overstate normalized earnings.`;
  } else if (ratio > 1.8) {
    severity = "stress-peak";
    message = `latest credit cost ${(latest * 100).toFixed(2)}% is ${(ratio * 100).toFixed(0)}% of trailing 7y median (${(med * 100).toFixed(2)}%) — cycle-peak stress; latest earnings depressed.`;
  } else {
    message = `latest credit cost ${(latest * 100).toFixed(2)}% is ${(ratio * 100).toFixed(0)}% of trailing 7y median (${(med * 100).toFixed(2)}%); within normal band.`;
  }
  return {
    status: "computed",
    medianCreditCost: med,
    latestCreditCost: latest,
    ratio,
    severity,
    message,
  };
}

// ── Lens 9: Spread Compression / Cost-of-Funds Sensitivity (Phase D3b) ──────
//
// Stress-tests the NBFC's ROA under wholesale funding cost shocks.
// NBFCs fund through NCDs + bank loans (not deposits), so a liquidity
// crisis directly compresses spread → ROA → ROE → justified P/B.
//
// Historical shock magnitudes (Indian NBFC market):
//   +150bps: IL&FS Sep 2018 — wholesale rates spiked within 3 months
//   +250bps: COVID Mar 2020 — CP/NCD markets froze, rollover risk
//   +100bps: Adani-Hindenburg Jan 2023 — contagion fears
//
// The stress test assumes:
//   - Yield on advances is sticky (can't reprice loans immediately)
//   - Cost of borrowings reprices fully (worst case — entire book rolls over)
//   - Operating expenses and credit cost unchanged
//   - Stressed ROA = (yield - stressed_cost - opex_ratio - credit_cost) × leverage_adj
//
// This is INFORMATIONAL — does not modify valuation. The analyst uses it
// to judge whether the base-case ROE assumption is fragile.
// ────────────────────────────────────────────────────────────────────────────

export function spreadCompressionCheck(metrics: BankPeriodMetrics[]): SpreadCompressionCheck {
  // Need at least 3 periods with spread data
  const withSpread = metrics.filter(m =>
    m.costOfBorrowings != null && m.yieldOnAdvances != null && m.spread != null
  );

  if (withSpread.length < 3) {
    return {
      status: "skipped",
      latestCostOfBorrowings: null,
      latestYieldOnAdvances: null,
      latestSpread: null,
      medianSpread: null,
      spreadRatio: null,
      cobTrendBps: null,
      stressedROA_150bps: null,
      stressedROA_250bps: null,
      currentROA: null,
      severity: "unknown",
      message: `only ${withSpread.length} periods with spread data (need ≥3)`,
    };
  }

  const latest = withSpread[withSpread.length - 1]!;
  const prior = withSpread[withSpread.length - 2]!;
  const latestCoB = latest.costOfBorrowings!;
  const latestYield = latest.yieldOnAdvances!;
  const latestSpread = latest.spread!;
  const currentROA = latest.roa;

  // Trailing 5y median spread
  const spreadSeries = withSpread.slice(-5).map(m => m.spread!);
  const sortedSpreads = [...spreadSeries].sort((a, b) => a - b);
  const mid = Math.floor(sortedSpreads.length / 2);
  const medianSpread = sortedSpreads.length % 2
    ? sortedSpreads[mid]!
    : (sortedSpreads[mid - 1]! + sortedSpreads[mid]!) / 2;

  // Spread ratio: < 1 means current spread is below median (compressed)
  const spreadRatio = medianSpread > 0 ? latestSpread / medianSpread : null;

  // CoB trend: YoY change in basis points
  const priorCoB = prior.costOfBorrowings!;
  const cobTrendBps = (latestCoB - priorCoB) * 10000; // decimal → bps

  // Stress test: what happens to ROA if CoB spikes?
  // Simplified: stressed_spread = yield - (cost + shock)
  // ROA impact ≈ spread_compression × (advances/assets) ratio
  // For NBFCs, advances ≈ 80-85% of assets, so we use 0.82 as proxy
  const advancesToAssets = latest.advances != null && latest.totalAssets != null && latest.totalAssets > 0
    ? latest.advances / latest.totalAssets
    : 0.82; // fallback for NBFCs

  // ROA under stress = current ROA - (shock × advances/assets)
  // This is because the CoB increase flows through to interest expense
  // which reduces PAT, and ROA = PAT / assets
  const stressedROA_150 = currentROA != null
    ? currentROA - (0.015 * advancesToAssets)
    : null;
  const stressedROA_250 = currentROA != null
    ? currentROA - (0.025 * advancesToAssets)
    : null;

  // Severity classification
  let severity: SpreadCompressionCheck["severity"];
  if (spreadRatio == null) {
    severity = "unknown";
  } else if (spreadRatio < 0.75) {
    severity = "compressed";
  } else if (spreadRatio > 1.15) {
    severity = "expanding";
  } else {
    severity = "normal";
  }

  // Build message
  const spreadBps = (latestSpread * 10000).toFixed(0);
  const medianBps = (medianSpread * 10000).toFixed(0);
  const cobPct = (latestCoB * 100).toFixed(2);
  const yieldPct = (latestYield * 100).toFixed(2);
  const trendDir = cobTrendBps > 20 ? "rising" : cobTrendBps < -20 ? "falling" : "stable";

  let message: string;
  if (severity === "compressed") {
    message = `Spread ${spreadBps}bps vs ${medianBps}bps median (${((spreadRatio!) * 100).toFixed(0)}%) — ` +
      `COMPRESSED. CoB ${cobPct}% (${trendDir}, ${cobTrendBps > 0 ? "+" : ""}${cobTrendBps.toFixed(0)}bps YoY). ` +
      `Stress test: +150bps shock → ROA ${stressedROA_150 != null ? (stressedROA_150 * 100).toFixed(2) : "?"}%, ` +
      `+250bps → ROA ${stressedROA_250 != null ? (stressedROA_250 * 100).toFixed(2) : "?"}%. ` +
      `Current ROA ${currentROA != null ? (currentROA * 100).toFixed(2) : "?"}%.`;
  } else if (severity === "expanding") {
    message = `Spread ${spreadBps}bps vs ${medianBps}bps median (${((spreadRatio!) * 100).toFixed(0)}%) — ` +
      `expanding (favorable). CoB ${cobPct}% (${trendDir}). Yield ${yieldPct}%.`;
  } else {
    message = `Spread ${spreadBps}bps vs ${medianBps}bps median (${spreadRatio != null ? ((spreadRatio * 100).toFixed(0) + "%") : "?"}) — ` +
      `within normal band. CoB ${cobPct}% (${trendDir}, ${cobTrendBps > 0 ? "+" : ""}${cobTrendBps.toFixed(0)}bps YoY). ` +
      `Stress test: +150bps shock → ROA ${stressedROA_150 != null ? (stressedROA_150 * 100).toFixed(2) : "?"}%, ` +
      `+250bps → ROA ${stressedROA_250 != null ? (stressedROA_250 * 100).toFixed(2) : "?"}%.`;
  }

  return {
    status: "computed",
    latestCostOfBorrowings: latestCoB,
    latestYieldOnAdvances: latestYield,
    latestSpread,
    medianSpread,
    spreadRatio,
    cobTrendBps,
    stressedROA_150bps: stressedROA_150,
    stressedROA_250bps: stressedROA_250,
    currentROA,
    severity,
    message,
  };
}

// ── Lens 8: ECL Stress Governor (Phase D3) ──────────────────────────────────
//
// Fades the justified P/B when the NBFC's uncovered credit stress exceeds
// healthy thresholds. Only modifies the Gordon-model output; other lenses
// (P/AUM, ROA×Leverage RI, Equity RI, DDM) use latest-period inputs which
// already self-correct when stress hits.
//
// The composite stress metric:
//   uncovered_stress = stage3_pct × (1 − ecl_coverage_pct / 100)
//                    + restructured_pct × 0.5
//
// Rationale for the 0.5 weight on restructured:
//   RBI's historical recovery rate on restructured NBFC assets is ~50%
//   (Source: RBI Financial Stability Report, Dec 2021, Table IV.6).
//   So restructured book carries roughly half the loss-given-default of
//   Stage 3 (which is fully credit-impaired).
//
// When ECL coverage is missing but Stage 3 is present:
//   Assume coverage = 0% (worst case). This penalizes missing data rather
//   than hiding risk — the analyst should investigate why coverage isn't
//   reported. The message explicitly flags this assumption.
//
// ────────────────────────────────────────────────────────────────────────────

export function eclStressGovernor(
  metrics: BankPeriodMetrics[],
  originalPB: number,
): { effectivePB: number; result: EclStressGovernorResult } {
  // Find the latest period with Stage 3 data
  const eligible = metrics.filter(m => m.quality && m.quality.stage3_pct != null);

  if (eligible.length === 0) {
    return {
      effectivePB: originalPB,
      result: {
        status: "skipped",
        latestStage3Pct: null,
        latestEclCoveragePct: null,
        latestRestructuredPct: null,
        latestStage2Pct: null,
        uncoveredStressPct: null,
        fadeFactor: 1.0,
        originalPB,
        effectivePB: originalPB,
        message: "stage3_pct missing from quality_indicators.json — ECL stress governor not applied. " +
                 "IndAS 109 staging data is only available from FY2019 onward.",
      },
    };
  }

  const latest = eligible[eligible.length - 1]!;
  const q = latest.quality!;
  const stage3 = q.stage3_pct!;
  const eclCoverage = q.ecl_coverage_pct ?? null;  // coerce undefined → null
  const restructured = q.restructured_pct ?? 0;
  const stage2 = q.stage2_pct ?? null;

  // Compute uncovered stress
  // If ECL coverage is missing, assume 0% (worst case — penalize missing data)
  const coveragePct = eclCoverage ?? 0;
  const uncoveredStage3 = stage3 * (1 - coveragePct / 100);
  // Restructured weighted at 50% (RBI historical recovery rate on restructured NBFC assets)
  const uncoveredStress = uncoveredStage3 + restructured * 0.5;

  // Compute fade factor using two-segment linear interpolation
  let fadeFactor: number;
  if (uncoveredStress < NBFC_ECL_STRESS_WARNING_PCT) {
    fadeFactor = 1.0;
  } else if (uncoveredStress < NBFC_ECL_STRESS_MID_PCT) {
    // Linear from 1.0 → MID_FACTOR over [WARNING, MID)
    const t = (uncoveredStress - NBFC_ECL_STRESS_WARNING_PCT) /
              (NBFC_ECL_STRESS_MID_PCT - NBFC_ECL_STRESS_WARNING_PCT);
    fadeFactor = 1.0 - t * (1.0 - NBFC_ECL_STRESS_MID_FACTOR);
  } else if (uncoveredStress < NBFC_ECL_STRESS_DISTRESS_PCT) {
    // Linear from MID_FACTOR → MIN_FACTOR over [MID, DISTRESS)
    const t = (uncoveredStress - NBFC_ECL_STRESS_MID_PCT) /
              (NBFC_ECL_STRESS_DISTRESS_PCT - NBFC_ECL_STRESS_MID_PCT);
    fadeFactor = NBFC_ECL_STRESS_MID_FACTOR - t * (NBFC_ECL_STRESS_MID_FACTOR - NBFC_ECL_STRESS_MIN_FACTOR);
  } else {
    fadeFactor = NBFC_ECL_STRESS_MIN_FACTOR;
  }

  const effectivePB = originalPB * fadeFactor;

  // Build human-readable message
  let message: string;
  const coverageNote = eclCoverage == null
    ? " ⚠️ ECL coverage not reported — assumed 0% (worst case)."
    : "";
  const restructuredNote = restructured > 0
    ? ` Restructured ${restructured.toFixed(2)}% (weighted 0.5× per RBI recovery norms).`
    : "";
  const stage2Note = stage2 != null && stage2 > 3.0
    ? ` ⚠️ Stage 2 watchlist elevated at ${stage2.toFixed(1)}% — potential future Stage 3 migration.`
    : "";

  if (fadeFactor >= 1.0) {
    message = `Uncovered stress ${uncoveredStress.toFixed(2)}% (Stage 3 ${stage3.toFixed(2)}%, ` +
              `ECL coverage ${coveragePct.toFixed(0)}%) — below ${NBFC_ECL_STRESS_WARNING_PCT}% threshold, ` +
              `no fade applied.${restructuredNote}${stage2Note}${coverageNote}`;
  } else {
    message = `Uncovered stress ${uncoveredStress.toFixed(2)}% (Stage 3 ${stage3.toFixed(2)}%, ` +
              `ECL coverage ${coveragePct.toFixed(0)}%).${restructuredNote} ` +
              `Fade factor ${fadeFactor.toFixed(3)}× applied — justified P/B faded from ` +
              `${originalPB.toFixed(2)}x to ${effectivePB.toFixed(2)}x.${stage2Note}${coverageNote}`;
  }

  return {
    effectivePB,
    result: {
      status: "computed",
      latestStage3Pct: stage3,
      latestEclCoveragePct: eclCoverage,
      latestRestructuredPct: restructured > 0 ? restructured : null,
      latestStage2Pct: stage2,
      uncoveredStressPct: uncoveredStress,
      fadeFactor,
      originalPB,
      effectivePB,
      message,
    },
  };
}
