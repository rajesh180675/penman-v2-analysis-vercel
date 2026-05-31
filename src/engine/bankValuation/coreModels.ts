import type { BankPeriodMetrics } from "../bankPipeline";
import { EngineConfig } from "../types";
import { trace } from "../../lib/traceLogger";
import type { BankValuationModelResult } from "./types";
import {
  LONG_RUN_BANK_ROE,
  MIN_KE_MINUS_G,
  median,
  skipped,
  computed,
} from "./shared";

// ─── Sustainable ROE estimation ─────────────────────────────────────────────

/**
 * Compute sustainable ROE as median of last 5 years' ROE, requiring at
 * least 3 valid (positive) observations. Caps the result at LONG_RUN_BANK_ROE
 * × 1.5 (= 19.5%) to prevent latest-cycle peaks from inflating valuations.
 */
export function computeSustainableROE(metrics: BankPeriodMetrics[]): { value: number | null; obsCount: number } {
  const recentRoe = metrics
    .slice(-5)
    .map((m) => m.roe)
    .filter((roe): roe is number => roe != null && Number.isFinite(roe) && roe > 0);

  if (recentRoe.length < 3) return { value: null, obsCount: recentRoe.length };

  const med = median(recentRoe);
  if (med == null) return { value: null, obsCount: recentRoe.length };

  // Cap at 1.5× long-run to avoid post-Covid 22%+ ROEs rolling forward forever.
  const cap = LONG_RUN_BANK_ROE * 1.5;
  return { value: Math.min(med, cap), obsCount: recentRoe.length };
}

// ─── Model 1: Justified P/B Gordon ──────────────────────────────────────────

export function justifiedPBGordon(
  bv: number | null,
  roe: number | null,
  ke: number,
  g: number,
  marketCap: number | null,
  isInsurance: boolean = false,
): BankValuationModelResult {
  if (bv == null || bv <= 0) return skipped("no positive latest book value");
  if (roe == null) return skipped("sustainable ROE could not be estimated (need ≥3y positive ROE)");
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke (${ke.toFixed(3)}) − g (${g.toFixed(3)}) below ${MIN_KE_MINUS_G} guardrail`);

  let fairPB = (roe - g) / (ke - g);
  let floored = false;
  // Floor at 0.3x for distressed banks (ROE << ke), 0.7x for insurance.
  // A negative fair P/B is economically meaningless — the floor represents
  // liquidation/franchise value even in a value-destroying scenario.
  const pbFloor = isInsurance ? 0.7 : 0.3;
  if (fairPB < pbFloor) {
    fairPB = pbFloor;
    floored = true;
  }
  const value = fairPB * bv;
  let reason = "";
  if (floored) {
    reason = `ROE ≤ ke → floored at 0.7x P/B for insurance business`;
  } else {
    reason = roe > ke
      ? `ROE > ke → business earning above cost of equity, fair P/B = ${fairPB.toFixed(2)}`
      : `ROE ≤ ke → business below cost of equity, fair P/B = ${fairPB.toFixed(2)} (≤ 1)`;
  }
  trace("valuation", "justifiedPBGordon", { roe, ke, g, bv, fairPB, floored, intrinsicValue: value });
  return computed(value, reason, { fairPB, roe, ke, g, bv }, marketCap);
}

// ─── Model 2: Equity Residual Income with fade ──────────────────────────────

export function equityResidualIncome(
  metrics: BankPeriodMetrics[],
  ke: number,
  g: number,
  marketCap: number | null,
  payoutRatio: number | null,
): BankValuationModelResult {
  // Need at least 3 years of book value AND positive earnings to anchor.
  const eligible = metrics.filter((m) => m.totalEquity != null && m.totalEquity > 0 && m.pat != null);
  if (eligible.length < 3) return skipped(`only ${eligible.length} usable periods, need ≥3 with positive book value`);

  const latest = eligible[eligible.length - 1]!;
  const bv0 = latest.totalEquity!;

  // Latest realized ROE (not sustainable) anchors the forward forecast.
  const latestROE = latest.roe;
  if (latestROE == null) return skipped("latest ROE unavailable for residual-income forecast");

  // 5-year explicit forecast with linear fade from latest ROE to LONG_RUN_BANK_ROE.
  const forecastYears = 5;
  let pvResidualIncome = 0;
  let bvForecast = bv0;
  for (let t = 1; t <= forecastYears; t++) {
    const fadeWeight = (t - 1) / (forecastYears - 1);
    const roeT = latestROE * (1 - fadeWeight) + LONG_RUN_BANK_ROE * fadeWeight;
    const ri = (roeT - ke) * bvForecast;
    pvResidualIncome += ri / Math.pow(1 + ke, t);
    bvForecast = bvForecast * (1 + roeT * (1 - (payoutRatio ?? 0.30))); // use actual payout if available
  }

  // Terminal value: LONG_RUN_BANK_ROE − ke spread, growing at g.
  // After the 5y loop bvForecast = BV₅, so terminalRI = (ROE − ke)·BV₅ is the
  // residual income of YEAR 6 on its opening book — i.e. RI₆, the FIRST flow of
  // the terminal perpetuity. The continuing value at the end of the explicit
  // period is therefore RI₆/(ke − g); no extra (1+g). A (1+g) here would push
  // the first flow to RI₇ and overstate the terminal value by one year's growth
  // (it would only be correct if terminalRI were RI₅, computed on BV₄).
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke − g below ${MIN_KE_MINUS_G} guardrail for terminal value`);
  const terminalRI = (LONG_RUN_BANK_ROE - ke) * bvForecast;
  const tvUndiscounted = terminalRI / (ke - g);
  const tv = tvUndiscounted / Math.pow(1 + ke, forecastYears);

  const value = bv0 + pvResidualIncome + tv;
  trace("valuation", "equityResidualIncome", { bv0, pvResidualIncome, tv, intrinsicValue: value });
  const reason = `bv₀ + 5y forecast PV (${pvResidualIncome.toFixed(0)}) + terminal (${tv.toFixed(0)})`;
  return computed(value, reason, {
    bv0,
    latestROE,
    pvResidualIncome,
    terminalValue: tv,
    forecastYears,
  }, marketCap);
}

// ─── Model 3: Sustainable DDM ───────────────────────────────────────────────

export function sustainableDDM(
  bv: number | null,
  pat: number | null,
  roe: number | null,
  ke: number,
  g: number,
  payoutRatio: number | null,
  marketCap: number | null,
): BankValuationModelResult {
  if (bv == null || bv <= 0) return skipped("no positive latest book value");
  if (pat == null || pat <= 0) return skipped("non-positive latest earnings; DDM requires going-concern profit");
  if (roe == null) return skipped("sustainable ROE unavailable; DDM needs ROE for growth-payout consistency check");
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke − g below ${MIN_KE_MINUS_G} guardrail`);

  // Default payout 30% if not derivable.
  const effectivePayout = payoutRatio ?? 0.30;

  // Sustainability: g must be ≤ retention × ROE = (1 − payout) × ROE.
  const sustainableG = (1 - effectivePayout) * roe;
  if (g > sustainableG + 0.005) {
    return skipped(`g (${(g * 100).toFixed(1)}%) exceeds sustainable g (${(sustainableG * 100).toFixed(1)}%) at payout ${(effectivePayout * 100).toFixed(0)}%`);
  }

  const expectedDividend = pat * effectivePayout * (1 + g);
  const value = expectedDividend / (ke - g);
  const reason = `dividend (${expectedDividend.toFixed(0)}) / (ke − g) at payout ${(effectivePayout * 100).toFixed(0)}%`;
  return computed(value, reason, {
    expectedDividend,
    payoutRatio: effectivePayout,
    sustainableG,
    pat,
    roe,
  }, marketCap);
}

// ─── Model 4: EV-Based Valuation ─────────────────────────────────────────────

export function evBasedValuation(
  metrics: BankPeriodMetrics[],
  marketCap: number | null,
  cfg: EngineConfig,
): BankValuationModelResult {
  const eligible = metrics.filter(m => m.quality && m.quality.embedded_value != null);
  if (eligible.length === 0) {
    return skipped("Embedded Value sidecar data unavailable (quality_indicators.json must supply embedded_value)");
  }
  const latest = eligible[eligible.length - 1]!;
  const ev = latest.quality!.embedded_value!;
  const vnb = latest.quality!.vnb ?? null;

  let fairValue = 0;
  let reason = "";
  const diagnostics: Record<string, number | null> = { embedded_value: ev, vnb };

  if (vnb != null && vnb > 0) {
    const multiple = cfg.insurance_vnb_multiple ?? 12;
    fairValue = ev + vnb * multiple;
    reason = `EV (${ev.toFixed(0)} Cr) + VNB (${vnb.toFixed(0)} Cr) × ${multiple}x multiple`;
    diagnostics.vnb_multiple = multiple;
  } else {
    const multiple = cfg.insurance_ev_multiple ?? 2.0;
    fairValue = ev * multiple;
    reason = `EV (${ev.toFixed(0)} Cr) × default ${multiple.toFixed(1)}x multiple (VNB missing)`;
    diagnostics.ev_multiple = multiple;
  }

  return computed(fairValue, reason, diagnostics, marketCap);
}
