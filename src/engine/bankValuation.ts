/**
 * Bank Valuation Models — Phase B4
 *
 * Banks cannot use Penman-Nissim's OA/FA reformulation (advances ARE the
 * operating asset; deposits ARE the operating liability). They need
 * equity-side models that price book value × profitability spread.
 *
 * Three models implemented:
 *
 * 1. Justified P/B (Gordon Growth, on equity)
 *    fair_PB = (ROE_sustainable − g) / (ke − g)
 *    fair_value = fair_PB × latest_book_value
 *    Best for: stable mature banks (HDFC, Kotak)
 *    Breaks when: ROE < ke (value-destroying bank), ke ≤ g
 *
 * 2. Equity Residual Income
 *    V = BV_0 + Σ_t [(ROE_t − ke) × BV_{t-1}] / (1+ke)^t  +  TV / (1+ke)^N
 *    Where TV uses fade to long-run ROE.
 *    Best for: banks with documented ROE evolution
 *    Breaks when: <3 years of positive ROE history
 *
 * 3. Sustainable DDM
 *    V = expected_dividend / (ke − g)  with sustainability check:
 *    payout_ratio ≤ 1 − g/ROE   (otherwise growth is not self-funded)
 *    Best for: dividend-paying banks (PSU banks, mature private banks)
 *    Breaks when: payout_ratio unavailable or ROE ≤ g
 *
 * All three are skip-with-reason when prerequisites fail rather than
 * producing misleading numbers.
 */

import type { BankPeriodMetrics } from "./bankPipeline";
import { EngineConfig, ke_from_config } from "./types";

/** Long-run ROE that any bank's ROE fades toward in residual-income terminal. */
const LONG_RUN_BANK_ROE = 0.13;

/** Default terminal growth: India long-run nominal GDP growth proxy. */
const DEFAULT_TERMINAL_GROWTH = 0.05;

/** Margin between ke and g for the no-blow-up gate. ke must exceed g by this. */
const MIN_KE_MINUS_G = 0.01;

export type BankValuationStatus = "computed" | "skipped";

export interface BankValuationModelResult {
  status: BankValuationStatus;
  /** Per-share or total intrinsic equity value (Cr). null when skipped. */
  intrinsicValue: number | null;
  /** Implied premium/discount vs market cap when supplied. null otherwise. */
  premiumOverMarket: number | null;
  /** Why the model produced the value or skipped. */
  reason: string;
  /** Diagnostic intermediates for traceability. */
  diagnostics: Record<string, number | null>;
}

export interface BankValuationBundle {
  /** Sustainable ROE used by Gordon and DDM. Median of last 5y, ≥0. */
  sustainableROE: number | null;
  /** Cost of equity from config. */
  ke: number;
  /** Terminal growth used. */
  terminalGrowth: number;
  /** Latest book value (Cr). */
  latestBookValue: number | null;
  /** Number of years of usable history (positive earnings + book value). */
  usableHistory: number;
  /** Optional payout ratio if derivable (currently null — CF parsing TBD). */
  payoutRatio: number | null;

  justifiedPB: BankValuationModelResult;
  equityResidualIncome: BankValuationModelResult;
  sustainableDDM: BankValuationModelResult;

  /** Triangulated central value (median of computed models). */
  triangulatedValue: number | null;
  /** Models that contributed to triangulation. */
  modelsContributing: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function skipped(reason: string, diagnostics: Record<string, number | null> = {}): BankValuationModelResult {
  return { status: "skipped", intrinsicValue: null, premiumOverMarket: null, reason, diagnostics };
}

function computed(intrinsicValue: number, reason: string, diagnostics: Record<string, number | null>, marketCap: number | null): BankValuationModelResult {
  const premiumOverMarket = marketCap != null && marketCap > 0
    ? intrinsicValue / marketCap - 1
    : null;
  return { status: "computed", intrinsicValue, premiumOverMarket, reason, diagnostics };
}

// ─── Sustainable ROE estimation ─────────────────────────────────────────────

/**
 * Compute sustainable ROE as median of last 5 years' ROE, requiring at
 * least 3 valid (positive) observations. Caps the result at LONG_RUN_BANK_ROE
 * × 1.5 (= 19.5%) to prevent latest-cycle peaks from inflating valuations.
 */
function computeSustainableROE(metrics: BankPeriodMetrics[]): { value: number | null; obsCount: number } {
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

function justifiedPBGordon(
  bv: number | null,
  roe: number | null,
  ke: number,
  g: number,
  marketCap: number | null,
): BankValuationModelResult {
  if (bv == null || bv <= 0) return skipped("no positive latest book value");
  if (roe == null) return skipped("sustainable ROE could not be estimated (need ≥3y positive ROE)");
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke (${ke.toFixed(3)}) − g (${g.toFixed(3)}) below ${MIN_KE_MINUS_G} guardrail`);

  const fairPB = (roe - g) / (ke - g);
  const value = fairPB * bv;
  const reason = roe > ke
    ? `ROE > ke → bank earning above cost of equity, fair P/B = ${fairPB.toFixed(2)}`
    : `ROE ≤ ke → bank below cost of equity, fair P/B = ${fairPB.toFixed(2)} (≤ 1)`;
  return computed(value, reason, { fairPB, roe, ke, g, bv }, marketCap);
}

// ─── Model 2: Equity Residual Income with fade ──────────────────────────────

function equityResidualIncome(
  metrics: BankPeriodMetrics[],
  ke: number,
  g: number,
  marketCap: number | null,
): BankValuationModelResult {
  // Need at least 3 years of book value AND positive earnings to anchor.
  const eligible = metrics.filter((m) => m.totalEquity != null && m.totalEquity > 0 && m.pat != null);
  if (eligible.length < 3) return skipped(`only ${eligible.length} usable periods, need ≥3 with positive book value`);

  const latest = eligible[eligible.length - 1];
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
    bvForecast = bvForecast * (1 + roeT * (1 - 0.30)); // assume 30% payout
  }

  // Terminal value: LONG_RUN_BANK_ROE − ke spread, growing at g.
  if (ke - g < MIN_KE_MINUS_G) return skipped(`ke − g below ${MIN_KE_MINUS_G} guardrail for terminal value`);
  const terminalRI = (LONG_RUN_BANK_ROE - ke) * bvForecast;
  const tvUndiscounted = terminalRI * (1 + g) / (ke - g);
  const tv = tvUndiscounted / Math.pow(1 + ke, forecastYears);

  const value = bv0 + pvResidualIncome + tv;
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

function sustainableDDM(
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

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Compute the bank valuation bundle. Returns a structured result with
 * three models, each independently computed or skipped with a reason.
 *
 * Caller passes the BankPeriodMetrics array from bankPipeline.ts plus
 * the standard EngineConfig. marketCap is optional — when provided each
 * model's premium-over-market is computed; otherwise null.
 *
 * Per S-9.4C: ke comes from ke_from_config(cfg), single source of truth.
 * Terminal growth uses cfg.terminal_growth_rate when present else
 * DEFAULT_TERMINAL_GROWTH.
 */
export function computeBankValuation(
  metrics: BankPeriodMetrics[],
  cfg: EngineConfig,
  marketCap: number | null = null,
  payoutRatio: number | null = null,
): BankValuationBundle {
  if (metrics.length === 0) {
    const skip = skipped("no bank metrics provided");
    return {
      sustainableROE: null,
      ke: ke_from_config(cfg),
      terminalGrowth: DEFAULT_TERMINAL_GROWTH,
      latestBookValue: null,
      usableHistory: 0,
      payoutRatio,
      justifiedPB: skip,
      equityResidualIncome: skip,
      sustainableDDM: skip,
      triangulatedValue: null,
      modelsContributing: [],
    };
  }

  const ke = ke_from_config(cfg);
  // Use cfg.terminal_growth_rate when present (cfg may not declare it strictly typed).
  const cfgAny = cfg as unknown as Record<string, unknown>;
  const cfgTerminalGrowth = typeof cfgAny.terminal_growth_rate === "number"
    ? (cfgAny.terminal_growth_rate as number)
    : null;
  const g = cfgTerminalGrowth ?? DEFAULT_TERMINAL_GROWTH;

  const latest = metrics[metrics.length - 1];
  const latestBV = latest.totalEquity;

  const { value: sustainableROE, obsCount } = computeSustainableROE(metrics);

  const justifiedPB = justifiedPBGordon(latestBV, sustainableROE, ke, g, marketCap);
  const eri = equityResidualIncome(metrics, ke, g, marketCap);
  const ddm = sustainableDDM(latestBV, latest.pat, sustainableROE, ke, g, payoutRatio, marketCap);

  const computedValues: Array<[string, number]> = [];
  if (justifiedPB.status === "computed" && justifiedPB.intrinsicValue != null) {
    computedValues.push(["Justified P/B Gordon", justifiedPB.intrinsicValue]);
  }
  if (eri.status === "computed" && eri.intrinsicValue != null) {
    computedValues.push(["Equity Residual Income", eri.intrinsicValue]);
  }
  if (ddm.status === "computed" && ddm.intrinsicValue != null) {
    computedValues.push(["Sustainable DDM", ddm.intrinsicValue]);
  }

  const triangulatedValue = computedValues.length > 0
    ? median(computedValues.map(([, v]) => v))
    : null;

  return {
    sustainableROE,
    ke,
    terminalGrowth: g,
    latestBookValue: latestBV,
    usableHistory: obsCount,
    payoutRatio,
    justifiedPB,
    equityResidualIncome: eri,
    sustainableDDM: ddm,
    triangulatedValue,
    modelsContributing: computedValues.map(([name]) => name),
  };
}
