/**
 * Bank Valuation Models — Phase B4 + Phase D2 (NBFC lenses)
 *
 * Banks cannot use Penman-Nissim's OA/FA reformulation (advances ARE the
 * operating asset; deposits ARE the operating liability). They need
 * equity-side models that price book value × profitability spread.
 *
 * Three core models implemented:
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
 * Phase D2 — NBFC-specific lenses (only fire when subtype is "nbfc"):
 *
 * 4. P/AUM (peer-anchored)
 *    fair_value = AUM × peer_implied_multiple
 *    Where multiple is derived from sustainable ROA: roa_to_paum = roa × 12-15
 *    Best for: NBFCs where AUM is the primary scale metric (Bajaj, Cholamandalam)
 *    Breaks when: aum_cr is missing from quality sidecar
 *
 * 5. ROA × Leverage three-stage RI
 *    Decomposes ROE into ROA × leverage and fades each separately.
 *    NBFCs revert ROA toward long-run-NBFC-ROA faster than they
 *    de-lever, so coupling them produces unrealistic valuations.
 *    Best for: NBFCs where leverage is a structural choice (Bajaj 4-5x)
 *
 * 6. CRAR governor (modifier, not standalone model)
 *    When CRAR headroom over RBI norm (15% for NBFC-UL) drops below
 *    300bps, growth must throttle because new advances need fresh capital.
 *    Adjusts effective g downward; affects all three core models.
 *
 * 7. Through-cycle credit-cost band
 *    Diagnostic: compares latest creditCost to trailing-7y median.
 *    Flags under-provisioning (post-Covid release) and stress peaks
 *    (FY18 IL&FS, FY20 Covid). Doesn't change valuation but is surfaced
 *    for the analyst.
 *
 * All lenses are skip-with-reason when prerequisites fail rather than
 * producing misleading numbers.
 */

import type { BankPeriodMetrics } from "./bankPipeline";
import { EngineConfig, ke_from_config } from "./types";
import type { SOTPResult, SegmentDefinition } from "./sotpValuation";

/** Lightweight three-scenario bundle for bank/NBFC valuation.
 *
 * Unlike ValuationScenarioCard (which requires a full ValuationResult
 * from the Penman-Nissim reformulation), this uses simplified bank-specific
 * metrics: ROE, P/B, and intrinsic value per share.
 * The UI can render these alongside the full VCC scenario cards.
 */
export interface BankScenarioCard {
  key: "stress" | "base" | "bull";
  label: string;
  probability: number;
  roe: number;
  ke: number;
  g: number;
  fairPB: number;
  intrinsicValue: number | null;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  reason: string;
}

export interface ScenarioBundle {
  cards: BankScenarioCard[];
  /** Which scenario is the "lead" (shown first in UI). */
  primary: "stress" | "base" | "bull";
}

/** Long-run ROE that any bank's ROE fades toward in residual-income terminal. */
const LONG_RUN_BANK_ROE = 0.13;

/** Long-run ROA the typical NBFC mean-reverts to. Bajaj historically prints 3-5%
 *  but the broader NBFC universe (gold, microfinance, vehicle, housing) is
 *  closer to 2.5%. Used in the ROA × Leverage RI decomposition. */
const LONG_RUN_NBFC_ROA = 0.025;

/** Long-run leverage that a regulated NBFC mean-reverts to. RBI Scale-Based
 *  Regulation places gearing limits between 4x (NBFC-UL) and 7x (NBFC-BL).
 *  5x is a defensible mid-cycle anchor across the industry. */
const LONG_RUN_NBFC_LEVERAGE = 5.0;

/** Typical earnings multiple applied to NBFC ROA when expressing AUM as
 *  market value. AUM × ROA gives normalized PAT; PAT × P/E gives equity
 *  value. So fair P/AUM ≈ ROA × P/E. We use 12x as the through-cycle
 *  Indian NBFC P/E anchor (slightly below the broader Nifty 50 multiple
 *  to reflect cyclicality of credit). */
const NBFC_PAUM_PE_MULTIPLIER = 12;

/** RBI minimum CRAR for NBFC-Upper Layer. NBFC-Middle Layer is 15% too;
 *  NBFC-Base Layer follows the same baseline. Source: RBI Master Direction
 *  on Scale Based Regulation (October 2022). */
const NBFC_MIN_CRAR_PCT = 15;

/** Buffer above the regulatory CRAR floor below which growth must
 *  throttle. NBFC-UL guidelines effectively require 200-300bps headroom
 *  to absorb stress. We use 300bps to be conservative — at headroom <
 *  300bps the model penalises g. */
const NBFC_CRAR_BUFFER_BPS = 300;

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

/** Diagnostic for through-cycle credit-cost band check (NBFC-only). */
export interface CreditCostCycleCheck {
  status: "computed" | "skipped";
  /** Trailing 7y median credit cost (decimal, e.g. 0.015 = 1.5%). */
  medianCreditCost: number | null;
  /** Latest period credit cost. */
  latestCreditCost: number | null;
  /** Latest / median ratio. */
  ratio: number | null;
  /** Severity tag: "under-provisioning" | "normal" | "stress-peak". */
  severity: "under-provisioning" | "normal" | "stress-peak" | "unknown";
  /** Human-readable explanation. */
  message: string;
}

/** Diagnostic for CRAR-buffer growth governor (NBFC-only). */
export interface CrarGovernorResult {
  status: "computed" | "skipped";
  /** Latest CRAR % from quality sidecar. */
  latestCrarPct: number | null;
  /** Required CRAR + buffer (e.g. 18% = 15% norm + 300bps buffer). */
  requiredCrarPct: number;
  /** Headroom in basis points. Negative when below required. */
  headroomBps: number | null;
  /** Original g (before governor) and effective g (after governor) — both
   *  expressed as decimals (e.g. 0.05 = 5%). */
  originalG: number;
  effectiveG: number;
  /** Reason for adjustment (or "no adjustment needed" when headroom OK). */
  message: string;
}

export interface BankValuationBundle {
  /** Sustainable ROE used by Gordon and DDM. Median of last 5y, ≥0. */
  sustainableROE: number | null;
  /** Cost of equity from config. */
  ke: number;
  /** Terminal growth used (post-CRAR-governor when NBFC). */
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
  /** Optional EV-based valuation for insurance subtype when embedded_value is present. */
  evBased?: BankValuationModelResult;
  /** Phase D2 — NBFC P/AUM lens. Only computed when subtype="nbfc"
   *  AND quality sidecar provides aum_cr. */
  pAum?: BankValuationModelResult;
  /** Phase D2 — NBFC ROA × Leverage three-stage residual income lens.
   *  Only computed when subtype="nbfc". */
  roaLeverageRI?: BankValuationModelResult;
  /** Phase D2 — Through-cycle credit-cost diagnostic (NBFC-only). */
  creditCostCycle?: CreditCostCycleCheck;
  /** Phase D2 — CRAR-buffer growth governor (NBFC-only). */
  crarGovernor?: CrarGovernorResult;

  /** Phase E — Three-scenario framework (bear/base/bull). */
  scenarios?: ScenarioBundle | null;
  /** Phase E — Subsidiary SOTP (sum-of-parts). */
  sotp?: SOTPResult;

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
  return computed(value, reason, { fairPB, roe, ke, g, bv }, marketCap);
}

// ─── Model 2: Equity Residual Income with fade ──────────────────────────────

function equityResidualIncome(
  metrics: BankPeriodMetrics[],
  ke: number,
  g: number,
  marketCap: number | null,
  payoutRatio: number | null,
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
    bvForecast = bvForecast * (1 + roeT * (1 - (payoutRatio ?? 0.30))); // use actual payout if available
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

// ─── Model 4: EV-Based Valuation ─────────────────────────────────────────────

function evBasedValuation(
  metrics: BankPeriodMetrics[],
  marketCap: number | null,
): BankValuationModelResult {
  const eligible = metrics.filter(m => m.quality && m.quality.embedded_value != null);
  if (eligible.length === 0) {
    return skipped("Embedded Value sidecar data unavailable (quality_indicators.json must supply embedded_value)");
  }
  const latest = eligible[eligible.length - 1];
  const ev = latest.quality!.embedded_value!;
  const vnb = latest.quality!.vnb ?? null;

  let fairValue = 0;
  let reason = "";
  const diagnostics: Record<string, number | null> = { embedded_value: ev, vnb };

  if (vnb != null && vnb > 0) {
    const multiple = 12;
    fairValue = ev + vnb * multiple;
    reason = `EV (${ev.toFixed(0)} Cr) + VNB (${vnb.toFixed(0)} Cr) × ${multiple}x multiple`;
    diagnostics.vnb_multiple = multiple;
  } else {
    const multiple = 2.0;
    fairValue = ev * multiple;
    reason = `EV (${ev.toFixed(0)} Cr) × default ${multiple.toFixed(1)}x multiple (VNB missing)`;
    diagnostics.ev_multiple = multiple;
  }

  return computed(fairValue, reason, diagnostics, marketCap);
}

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

function pAumLens(
  metrics: BankPeriodMetrics[],
  marketCap: number | null,
): BankValuationModelResult {
  // Need latest period's AUM from quality sidecar
  const eligibleAum = metrics.filter(m => m.quality && m.quality.aum_cr != null);
  if (eligibleAum.length === 0) {
    return skipped("aum_cr missing from quality_indicators.json (NBFC P/AUM needs AUM data)");
  }
  const latestWithAum = eligibleAum[eligibleAum.length - 1];
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
function roaLeverageRI(
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
  const latest = eligible[eligible.length - 1];
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

  // Terminal: long-run ROA × long-run leverage
  const terminalROE = LONG_RUN_NBFC_ROA * (1 + sustainableLev);
  const terminalRI = (terminalROE - ke) * bvForecast;
  const tvUndiscounted = terminalRI * (1 + g) / (ke - g);
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
function crarGovernor(
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
  const latest = eligible[eligible.length - 1];
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
function creditCostCycle(metrics: BankPeriodMetrics[]): CreditCostCycleCheck {
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
  const latest = metrics[metrics.length - 1].creditCost;
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

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Compute the bank valuation bundle. Returns a structured result with
 * three core models, each independently computed or skipped with a reason.
 *
 * Caller passes the BankPeriodMetrics array from bankPipeline.ts plus
 * the standard EngineConfig. marketCap is optional — when provided each
 * model's premium-over-market is computed; otherwise null.
 *
 * Per S-9.4C: ke comes from ke_from_config(cfg), single source of truth.
 * Terminal growth uses cfg.terminal_growth_rate when present else
 * DEFAULT_TERMINAL_GROWTH.
 *
 * Phase D2 — when subtype is "nbfc", four additional NBFC-specific lenses
 * fire (P/AUM, ROA × Leverage RI, CRAR governor, credit-cost cycle check).
 * The CRAR governor adjusts effective `g` for the three core models too,
 * so an NBFC near the regulatory floor can't claim a 5% growth assumption.
 */
export function computeBankValuation(
  metrics: BankPeriodMetrics[],
  cfg: EngineConfig,
  marketCap: number | null = null,
  payoutRatio: number | null = null,
  isInsurance: boolean = false,
  isNbfc: boolean = false,
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
      // evBased / pAum / roaLeverageRI intentionally omitted — no metrics.
      triangulatedValue: null,
      modelsContributing: [],
    };
  }

  const ke = ke_from_config(cfg);
  const originalG = cfg.terminal_growth_rate ?? DEFAULT_TERMINAL_GROWTH;

  // Phase D2 — apply CRAR-buffer governor for NBFCs so all downstream
  // models see the throttled g. Banks/insurance unaffected (no governor).
  let g = originalG;
  let crarGovernorResult: CrarGovernorResult | undefined;
  if (isNbfc) {
    const gov = crarGovernor(metrics, originalG);
    g = gov.effectiveG;
    crarGovernorResult = gov.result;
  }

  const latest = metrics[metrics.length - 1];
  const latestBV = latest.totalEquity;

  const { value: sustainableROE, obsCount } = computeSustainableROE(metrics);

  const justifiedPB = justifiedPBGordon(latestBV, sustainableROE, ke, g, marketCap, isInsurance);
  const eri = equityResidualIncome(metrics, ke, g, marketCap, payoutRatio);
  const ddm = sustainableDDM(latestBV, latest.pat, sustainableROE, ke, g, payoutRatio, marketCap);
  const evBased = evBasedValuation(metrics, marketCap);

  // Phase D2 — NBFC-only lenses.
  let pAum: BankValuationModelResult | undefined;
  let roaLevRI: BankValuationModelResult | undefined;
  let creditCostCycleResult: CreditCostCycleCheck | undefined;
  if (isNbfc) {
    pAum = pAumLens(metrics, marketCap);
    roaLevRI = roaLeverageRI(metrics, ke, g, marketCap, payoutRatio);
    creditCostCycleResult = creditCostCycle(metrics);
  }

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
  if (evBased.status === "computed" && evBased.intrinsicValue != null) {
    computedValues.push(["EV Based Valuation", evBased.intrinsicValue]);
  }
  // NBFC lenses also contribute to triangulation (median of all computed).
  if (pAum && pAum.status === "computed" && pAum.intrinsicValue != null) {
    computedValues.push(["P/AUM (NBFC)", pAum.intrinsicValue]);
  }
  if (roaLevRI && roaLevRI.status === "computed" && roaLevRI.intrinsicValue != null) {
    computedValues.push(["ROA × Leverage RI (NBFC)", roaLevRI.intrinsicValue]);
  }

  // For insurance: EV-based is the IRDAI-mandated actuarial primary. When it is
  // computed we use it directly as the triangulated value; the other three models
  // (Gordon, RI, DDM) are displayed as sanity range brackets rather than being
  // averaged with EV (which would dramatically dilute the actuarial estimate).
  // For banks/NBFCs the original median-of-all-computed-models is preserved.
  let triangulatedValue: number | null = null;
  if (isInsurance && evBased.status === "computed" && evBased.intrinsicValue != null) {
    triangulatedValue = evBased.intrinsicValue;
  } else {
    triangulatedValue = computedValues.length > 0
      ? median(computedValues.map(([, v]) => v))
      : null;
  }

  // Phase E — Build three-scenario bundle
  const scenarioBundle = buildBankScenarioBundle({
    sustainableROE, ke, terminalGrowth: g,
    latestBookValue: latestBV, marketCap,
    isNbfc,
  });

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
    evBased,
    pAum,
    roaLeverageRI: roaLevRI,
    creditCostCycle: creditCostCycleResult,
    crarGovernor: crarGovernorResult,
    scenarios: scenarioBundle,
    triangulatedValue,
    modelsContributing: computedValues.map(([name]) => name),
  };
}


// ─── Three-Scenario Framework for Banks/NBFCs ────────────────────────────

/**
 * Build a three-scenario bundle (bear/base/bull) for bank/NBFC valuation.
 *
 * Bank scenarios differ from industrial scenarios because:
 * - RNOA/ATO decomposition is meaningless; ROE/leverage are the drivers
 * - Credit cost cycle is a key swing factor (base vs stress)
 * - CRAR buffer governs sustainable growth
 * - Net interest margin (NIM) persistence matters more than PM persistence
 *
 * This creates lightweight scenario cards by adjusting the base
 * Gordon P/B model parameters: ROE, ke, and g.
 */
export function buildBankScenarioBundle(params: {
  sustainableROE: number | null;
  ke: number;
  terminalGrowth: number;
  latestBookValue: number | null;
  marketCap: number | null;
  isNbfc: boolean;
}): ScenarioBundle | null {
  const { sustainableROE, ke, terminalGrowth: baseG, latestBookValue, marketCap, isNbfc } = params;
  if (sustainableROE == null || latestBookValue == null || latestBookValue <= 0) return null;

  const cards: BankScenarioCard[] = [
    // BEAR: lower ROE, lower growth, higher ke (credit-cost stress)
    buildBankCard("stress", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, -0.04, -0.015, 0.02),
    // BASE: as-is
    buildBankCard("base", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, 0, 0, 0),
    // BULL: higher ROE, higher growth, lower ke
    buildBankCard("bull", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, 0.03, 0.01, -0.01),
  ];

  return { cards, primary: "base" };
}

function buildBankCard(
  key: "stress" | "base" | "bull",
  baseROE: number,
  baseKe: number,
  baseG: number,
  bv: number,
  marketCap: number | null,
  isNbfc: boolean,
  roeAdj: number,
  gAdj: number,
  keAdj: number,
): BankScenarioCard {
  const roe = Math.max(baseROE + roeAdj, 0.005);
  const ke = baseKe + keAdj;
  const g = Math.max(0, baseG + gAdj);
  const keMinusG = ke - g;
  const pbFloor = isNbfc ? 0.3 : 0.2;
  const fairPB = keMinusG > 0.001
    ? Math.max((roe - g) / keMinusG, pbFloor)
    : pbFloor;

  const intrinsicValue = fairPB * bv;
  const intrinsicPerShare = null; // Requires shares outstanding — filled by UI from market data
  const upsidePct = marketCap != null && marketCap > 0
    ? intrinsicValue / marketCap - 1
    : null;
  const marginOfSafetyPct = upsidePct;

  const label = key === "stress" ? "Bear" : key === "bull" ? "Bull" : "Base";
  const probability = key === "base" ? 0.5 : key === "stress" ? 0.2 : 0.3;

  return {
    key,
    label: `${label} (Bank)`,
    probability,
    roe,
    ke,
    g,
    fairPB,
    intrinsicValue,
    intrinsicPerShare,
    upsidePct,
    marginOfSafetyPct,
    reason: `ROE=${(roe*100).toFixed(1)}%, ke=${(ke*100).toFixed(1)}%, g=${(g*100).toFixed(1)}% → P/B=${fairPB.toFixed(2)}`,
  };
}

// ─── SOTP for Bank/NBFC ──────────────────────────────────────────────────

/**
 * Build SOTP (Sum-of-the-Parts) valuation for a bank/NBFC with subsidiaries.
 *
 * Bajaj Finance has identifiable lending segments (consumer, SME, commercial,
 * rural) with different risk profiles. The SOTP valuation is computed by the
 * existing `buildSOTPValuation` engine when segment data is available.
 *
 * This bridge function is a placeholder — the actual SOTP computation is
 * best done at the pipeline layer (bankPipeline.ts) where RecastPeriod data
 * is available, not here where only BankPeriodMetrics exist.
 * The `sotp` field on BankValuationBundle is populated by the pipeline caller.
 */
export function buildBankSOTP(_params: {
  metrics: BankPeriodMetrics[];
  ke: number;
  segments?: SegmentDefinition[];
}): SOTPResult | null {
  // SOTP requires RecastPeriod data which is not available from BankPeriodMetrics alone.
  // The pipeline layer (bankPipeline.ts) should call buildSOTPValuation directly
  // when segment data is present, and assign the result to this field.
  return null;
}
