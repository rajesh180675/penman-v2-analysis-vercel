import type { BankPeriodMetrics } from "../bankPipeline";
import type {
  BankValuationModelResult,
  CreditCostCycleCheck,
  SpreadCompressionCheck,
  CrarGovernorResult,
  EclStressGovernorResult,
} from "./types";
import {
  LONG_RUN_NBFC_ROA,
  LONG_RUN_NBFC_LEVERAGE,
  NBFC_PAUM_PE_MULTIPLIER,
  NBFC_MIN_CRAR_PCT,
  NBFC_CRAR_BUFFER_BPS,
  NBFC_ECL_STRESS_WARNING_PCT,
  NBFC_ECL_STRESS_MID_PCT,
  NBFC_ECL_STRESS_DISTRESS_PCT,
  NBFC_ECL_STRESS_MID_FACTOR,
  NBFC_ECL_STRESS_MIN_FACTOR,
  MIN_KE_MINUS_G,
  median,
  skipped,
  computed,
} from "./shared";

// ─── Phase D2: NBFC Lenses ──────────────────────────────────────────────────

/**
 * Sustainable ROA estimation — analogous to computeSustainableROE but
 * over `m.roa`. NBFCs use ROA × leverage decomposition, so this is
 * the right anchor for P/AUM and ROA-leverage RI.
 */
function computeSustainableROA(metrics: BankPeriodMetrics[]): { value: number | null; obsCount: number } {
  const recentRoa = metrics
    .slice(-5)
    .map((m) => m.roa)
    .filter((roa): roa is number => roa != null && Number.isFinite(roa) && roa > 0);
  if (recentRoa.length < 3) return { value: null, obsCount: recentRoa.length };
  const med = median(recentRoa);
  if (med == null) return { value: null, obsCount: recentRoa.length };
  // Cap at 1.5× long-run NBFC ROA (≈3.75%) to avoid post-Covid peaks
  // rolling forward forever.
  const cap = LONG_RUN_NBFC_ROA * 1.5;
  return { value: Math.min(med, cap), obsCount: recentRoa.length };
}

/**
 * Sustainable leverage estimation. NBFCs structurally choose leverage
 * (4-7x for regulated entities); we want the through-cycle anchor, not
 * a single-year snapshot.
 */
function computeSustainableLeverage(metrics: BankPeriodMetrics[]): number | null {
  const recent = metrics
    .slice(-5)
    .map((m) => m.leverage)
    .filter((l): l is number => l != null && Number.isFinite(l) && l > 0);
  if (recent.length < 3) return null;
  return median(recent);
}

// ── Lens 4: P/AUM (peer-anchored) ───────────────────────────────────────────

export function pAumLens(
  metrics: BankPeriodMetrics[],
  marketCap: number | null,
): BankValuationModelResult {
  // Need latest period's AUM from quality sidecar
  const eligibleAum = metrics.filter(m => m.quality && m.quality.aum_cr != null);
  if (eligibleAum.length === 0) {
    return skipped("aum_cr missing from quality_indicators.json (NBFC P/AUM needs AUM data)");
  }
  const latestWithAum = eligibleAum[eligibleAum.length - 1]!;
  const aum = latestWithAum.quality!.aum_cr!;
  if (aum <= 0) return skipped("non-positive AUM");

  // Sustainable ROA × P/E multiple gives implied P/AUM.
  // Logic: AUM × ROA = normalized PAT; PAT × P/E = market value;
  // so fair_value = AUM × ROA × P/E, equivalently fair_PAUM = ROA × P/E.
  const { value: roaSustainable } = computeSustainableROA(metrics);
  if (roaSustainable == null) {
    return skipped("sustainable ROA could not be estimated (need ≥3y positive ROA)");
  }

  const impliedPaum = roaSustainable * NBFC_PAUM_PE_MULTIPLIER;
  const fairValue = aum * impliedPaum;
  const reason = `AUM (${aum.toFixed(0)} Cr) × implied P/AUM (${impliedPaum.toFixed(2)}) ` +
    `= ROA ${(roaSustainable * 100).toFixed(2)}% × ${NBFC_PAUM_PE_MULTIPLIER}x P/E`;
  return computed(fairValue, reason, {
    aum,
    roaSustainable,
    impliedPaum,
    peMultiple: NBFC_PAUM_PE_MULTIPLIER,
  }, marketCap);
}

// ── Lens 5: ROA × Leverage three-stage Residual Income ──────────────────────

/**
 * NBFC residual income decomposed into ROA × leverage. ROA reverts toward
 * LONG_RUN_NBFC_ROA over the explicit forecast; leverage reverts toward
 * LONG_RUN_NBFC_LEVERAGE on a slower schedule (NBFCs cannot de-lever in 5y
 * without shrinking the book, which they don't do absent regulatory force).
 *
 * Three stages:
 *   - Stage 1 (years 1-3): half-fade of ROA (50% weight to long-run by Y3)
 *   - Stage 2 (years 4-7): full fade complete to long-run by Y7
 *   - Stage 3 (terminal): long-run ROA × long-run leverage at g
 *
 * Leverage fades linearly from observed to long-run over Y1-Y7.
 */
export function roaLeverageRI(
  metrics: BankPeriodMetrics[],
  ke: number,
  g: number,
  marketCap: number | null,
  payoutRatio: number | null,
): BankValuationModelResult {
  const eligible = metrics.filter(m =>
    m.totalEquity != null && m.totalEquity > 0 && m.pat != null
  );
  if (eligible.length < 3) {
    return skipped(`only ${eligible.length} usable periods, need ≥3 with positive book value`);
  }
  const latest = eligible[eligible.length - 1]!;
  const bv0 = latest.totalEquity!;
  const latestROA = latest.roa;
  const latestLeverage = latest.leverage;
  if (latestROA == null) return skipped("latest ROA unavailable");
  if (latestLeverage == null) return skipped("latest leverage unavailable (NBFC borrowings/equity)");
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke − g below ${MIN_KE_MINUS_G} guardrail`);

  const sustainableLev = computeSustainableLeverage(metrics) ?? LONG_RUN_NBFC_LEVERAGE;

  const forecastYears = 7;
  let pvResidualIncome = 0;
  let bvForecast = bv0;
  for (let t = 1; t <= forecastYears; t++) {
    // ROA fade: half-fade by Y3, full by Y7
    const roaFadeWeight = Math.min(t / forecastYears, 1);
    const roaT = latestROA * (1 - roaFadeWeight) + LONG_RUN_NBFC_ROA * roaFadeWeight;

    // Leverage fade: linear from latest to sustainableLev over Y1-Y7
    const levFadeWeight = Math.min(t / forecastYears, 1);
    const levT = latestLeverage * (1 - levFadeWeight) + sustainableLev * levFadeWeight;

    // Implied ROE for this year = ROA × (1 + leverage), where leverage is
    // borrowings/equity. ROE = PAT/equity = (PAT/assets) × (assets/equity)
    // and assets/equity = 1 + leverage when leverage = borrowings/equity.
    const roeT = roaT * (1 + levT);
    const ri = (roeT - ke) * bvForecast;
    pvResidualIncome += ri / Math.pow(1 + ke, t);
    bvForecast = bvForecast * (1 + roeT * (1 - (payoutRatio ?? 0.20))); // NBFC retain ~80%
  }

  // Terminal: long-run ROA × long-run leverage.
  // After the 7y loop bvForecast = BV₇, so terminalRI = (ROE − ke)·BV₇ is the
  // residual income of YEAR 8 on its opening book — i.e. RI₈, the FIRST flow of
  // the terminal perpetuity. The continuing value is RI₈/(ke − g); no extra
  // (1+g) (that would push the first flow to RI₉ and overstate TV by one year's
  // growth — it would only be correct if terminalRI were RI₇, on BV₆).
  const terminalROE = LONG_RUN_NBFC_ROA * (1 + sustainableLev);
  const terminalRI = (terminalROE - ke) * bvForecast;
  const tvUndiscounted = terminalRI / (ke - g);
  const tv = tvUndiscounted / Math.pow(1 + ke, forecastYears);

  const value = bv0 + pvResidualIncome + tv;
  const reason = `bv₀ (${bv0.toFixed(0)}) + 7y PV (${pvResidualIncome.toFixed(0)}) + ` +
    `terminal (${tv.toFixed(0)}) at ROA ${(LONG_RUN_NBFC_ROA * 100).toFixed(2)}% × leverage ${sustainableLev.toFixed(1)}x`;
  return computed(value, reason, {
    bv0,
    latestROA,
    latestLeverage,
    sustainableLeverage: sustainableLev,
    pvResidualIncome,
    terminalValue: tv,
    forecastYears,
  }, marketCap);
}

// ── Lens 6: CRAR-buffer growth governor ─────────────────────────────────────

/**
 * When CRAR headroom over the regulatory 15% norm drops below 300bps,
 * the NBFC must throttle growth — new advances need fresh capital, and
 * external capital is dilutive. We reduce effective `g` proportionally
 * to the headroom shortfall.
 *
 * Formula: if headroom_bps >= 300 → no adjustment.
 *          if headroom_bps < 300  → effective_g = g × (headroom_bps / 300)
 *          if headroom_bps <= 0   → effective_g = max(0, g × 0.25)
 */
export function crarGovernor(
  metrics: BankPeriodMetrics[],
  originalG: number,
): { effectiveG: number; result: CrarGovernorResult } {
  const required = NBFC_MIN_CRAR_PCT + NBFC_CRAR_BUFFER_BPS / 100;
  const eligible = metrics.filter(m => m.quality && m.quality.crar_pct != null);
  if (eligible.length === 0) {
    return {
      effectiveG: originalG,
      result: {
        status: "skipped",
        latestCrarPct: null,
        requiredCrarPct: required,
        headroomBps: null,
        originalG,
        effectiveG: originalG,
        message: "crar_pct missing from quality_indicators.json — no governor applied",
      },
    };
  }
  const latest = eligible[eligible.length - 1]!;
  const crar = latest.quality!.crar_pct!;
  const headroomBps = (crar - required) * 100;

  let effectiveG = originalG;
  let message: string;
  if (headroomBps >= NBFC_CRAR_BUFFER_BPS) {
    message = `CRAR ${crar.toFixed(2)}% — ${headroomBps.toFixed(0)}bps headroom over RBI norm + buffer (${required.toFixed(2)}%); no throttle.`;
  } else if (headroomBps > 0) {
    const factor = headroomBps / NBFC_CRAR_BUFFER_BPS;
    effectiveG = originalG * factor;
    message = `CRAR ${crar.toFixed(2)}% — only ${headroomBps.toFixed(0)}bps headroom; throttling g from ${(originalG * 100).toFixed(2)}% to ${(effectiveG * 100).toFixed(2)}% (factor ${factor.toFixed(2)}x).`;
  } else {
    effectiveG = Math.max(0, originalG * 0.25);
    message = `CRAR ${crar.toFixed(2)}% BELOW required ${required.toFixed(2)}% — capital raise required; g floor ${(effectiveG * 100).toFixed(2)}%.`;
  }

  return {
    effectiveG,
    result: {
      status: "computed",
      latestCrarPct: crar,
      requiredCrarPct: required,
      headroomBps,
      originalG,
      effectiveG,
      message,
    },
  };
}

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
