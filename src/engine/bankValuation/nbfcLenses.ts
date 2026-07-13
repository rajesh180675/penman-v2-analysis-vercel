import type { BankPeriodMetrics } from "../bankPipeline/metrics";
import type {
  BankValuationModelResult,
  CrarGovernorResult,
} from "./types";
import {
  LONG_RUN_NBFC_ROA,
  LONG_RUN_NBFC_LEVERAGE,
  NBFC_PAUM_PE_MULTIPLIER,
  NBFC_MIN_CRAR_PCT,
  NBFC_CRAR_BUFFER_BPS,
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
 *          if 0 < headroom_bps < 300 → effective_g = g × max(headroom_bps / 300, 0.25)
 *          if headroom_bps <= 0   → effective_g = max(0, g × 0.25)
 * The 0.25 floor on the middle branch keeps the governor monotonic in headroom
 * (a thinly-but-positively capitalised firm never gets less growth than a
 * below-norm one) and continuous at the headroom → 0 boundary.
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
    // Floor the throttle at 0.25× so the governor stays monotonic in capital
    // headroom: without the floor, factor = headroomBps/buffer falls below 0.25
    // for headroom < 75bps, handing a thinly-capitalised-but-positive bank LESS
    // permitted growth than the 0.25× floor granted to a below-norm bank in the
    // branch below — i.e. less headroom → more growth, and a discontinuity as
    // headroom → 0⁺. Matches the below-norm floor at the boundary.
    const factor = Math.max(headroomBps / NBFC_CRAR_BUFFER_BPS, 0.25);
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

export {
  creditCostCycle,
  spreadCompressionCheck,
  eclStressGovernor,
} from "./nbfcRiskChecks";
