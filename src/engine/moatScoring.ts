/**
 * Economic Moat Scoring Module
 *
 * Quantifies the durability and width of a company's competitive advantage
 * using purely financial evidence from the recast data.
 *
 * Framework: Buffett/Munger moat analysis operationalized through
 * Penman-Nissim ratios. No qualitative inputs required — the numbers
 * speak for themselves.
 *
 * Five moat dimensions:
 *   1. RNOA Persistence    — does RNOA stay above cost of capital over time?
 *   2. SPREAD Durability   — is RNOA − kw consistently positive?
 *   3. Margin Stability    — how stable is CoreSalesPM across the cycle?
 *   4. Reinvestment Quality — does incremental NOA earn above kw?
 *   5. Competitive Advantage Period (CAP) — how many years until RNOA fades to kw?
 *
 * Moat width classification:
 *   Wide   — score ≥ 70, SPREAD > 5% for 7+ years
 *   Narrow — score ≥ 40, SPREAD > 0% for 4+ years
 *   None   — score < 40 or SPREAD ≤ 0% in majority of periods
 *
 * For banks: uses ROE-based moat (ROE vs ke) instead of RNOA/SPREAD.
 */

import { RecastPeriod, EngineConfig, ke_from_config, deriveKwFromConfig } from "./types";
import { BankPeriodMetrics } from "./bankPipeline";

// ─── Output Types ─────────────────────────────────────────────────────────────

export type MoatWidth = "wide" | "narrow" | "none" | "insufficient-data";

export interface MoatDimension {
  name: string;
  score: number;          // 0–100
  weight: number;         // contribution weight in composite
  evidence: string[];     // human-readable evidence lines
  rawValues: Array<{ period: string; value: number | null }>;
}

export interface CAPEstimate {
  /** Estimated years until RNOA fades to kw (competitive advantage period) */
  years: number | null;
  /** AR(1) phi used for fade estimation */
  phi: number | null;
  /** Latest RNOA */
  latestRNOA: number | null;
  /** Cost of capital (kw) used as fade target */
  kw: number;
  /** Confidence in CAP estimate */
  confidence: "high" | "medium" | "low";
  /** Method used */
  method: "ar1-fade" | "linear-extrapolation" | "insufficient-data";
}

export interface MoatScoreResult {
  /** Composite moat score 0–100 */
  compositeScore: number;
  /** Moat width classification */
  moatWidth: MoatWidth;
  /** Individual dimension scores */
  dimensions: MoatDimension[];
  /** Competitive advantage period estimate */
  cap: CAPEstimate;
  /** Number of periods with SPREAD > 0 */
  periodsAboveCostOfCapital: number;
  /** Number of periods with SPREAD > 5% */
  periodsWithStrongSpread: number;
  /** Total periods analyzed */
  totalPeriods: number;
  /** Median RNOA across history */
  medianRNOA: number | null;
  /** Median SPREAD across history */
  medianSPREAD: number | null;
  /** Median CoreSalesPM across history */
  medianCorePM: number | null;
  /** Trend: is moat strengthening or eroding? */
  moatTrend: "strengthening" | "stable" | "eroding" | "insufficient-data";
  /** Notes on data quality */
  notes: string[];
}

/** Bank-specific moat result (ROE-based) */
export interface BankMoatResult {
  compositeScore: number;
  moatWidth: MoatWidth;
  medianROE: number | null;
  medianROESpread: number | null;  // ROE − ke
  periodsAboveKe: number;
  totalPeriods: number;
  cap: CAPEstimate;
  moatTrend: "strengthening" | "stable" | "eroding" | "insufficient-data";
  notes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stdDev(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length < 2) return null;
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Clamp AR(1) phi to a stable, economically defensible range [0, 0.95].
 * - Negative phi (oscillatory) is clamped to 0 — AR(1) fade math assumes monotone decay.
 * - phi >= 1 produces infinite/non-finite CAP; cap at 0.95.
 *
 * Project rule (CLAUDE.md S-9.4C): phi must be clamped before any fade calc
 * (review C7). Single source of truth here so callers can't bypass.
 */
function clampPhi(phi: number | null): number | null {
  if (phi == null || !Number.isFinite(phi)) return null;
  return Math.max(0, Math.min(0.95, phi));
}

/**
 * Estimate AR(1) phi from a time series using OLS.
 * phi = Cov(x_t, x_{t-1}) / Var(x_{t-1})
 */
function estimatePhi(series: number[]): number | null {
  if (series.length < 4) return null;
  const x = series.slice(0, -1);
  const y = series.slice(1);
  const n = x.length;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  const cov = x.reduce((s, v, i) => s + (v - meanX) * (y[i] - meanY), 0);
  const varX = x.reduce((s, v) => s + (v - meanX) ** 2, 0);
  if (varX < 1e-10) return null;
  const phi = cov / varX;
  // Negative phi indicates oscillatory behavior (cyclical industries).
  // We do not clamp here; callers should check phi range before using for fade.
  return phi;
}

/**
 * Estimate CAP: years until RNOA fades to kw using AR(1) model.
 * RNOA_t = kw + (RNOA_0 - kw) * phi^t
 * Solve for t: t = log(threshold / spread_0) / log(phi)
 * where threshold = 0.01 (within 1% of kw)
 */
function estimateCAP(
  latestRNOA: number,
  kw: number,
  phi: number | null,
  rnoaSeries: number[],
): CAPEstimate {
  const spread0 = latestRNOA - kw;
  const phiClamped = clampPhi(phi);

  if (spread0 <= 0) {
    return {
      years: 0,
      phi: phiClamped,
      latestRNOA,
      kw,
      confidence: "high",
      method: "ar1-fade",
    };
  }

  if (phiClamped != null && phiClamped > 0 && phiClamped < 1) {
    // t = log(0.01 / spread0) / log(phi)
    const threshold = 0.01;
    const t = Math.log(threshold / spread0) / Math.log(phiClamped);
    const years = t > 0 ? Math.round(Math.min(t, 50)) : null;
    return {
      years,
      phi: phiClamped,
      latestRNOA,
      kw,
      confidence: rnoaSeries.length >= 7 ? "high" : "medium",
      method: "ar1-fade",
    };
  }

  // Fallback: linear extrapolation from last 3 periods
  if (rnoaSeries.length >= 3) {
    const recent = rnoaSeries.slice(-3);
    const slope = (recent[2] - recent[0]) / 2;
    if (slope < 0 && spread0 > 0) {
      const years = Math.round(Math.min(spread0 / Math.abs(slope), 50));
      return {
        years,
        phi: null,
        latestRNOA,
        kw,
        confidence: "low",
        method: "linear-extrapolation",
      };
    }
  }

  return {
    years: null,
    phi: phiClamped,
    latestRNOA,
    kw,
    confidence: "low",
    method: "insufficient-data",
  };
}

function computeTrend(
  values: Array<number | null>,
): "strengthening" | "stable" | "eroding" | "insufficient-data" {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length < 4) return "insufficient-data";
  const mid = Math.floor(clean.length / 2);
  const firstHalf  = clean.slice(0, mid);
  const secondHalf = clean.slice(mid);
  const avgFirst  = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const delta = avgSecond - avgFirst;
  if (delta > 0.01)  return "strengthening";
  if (delta < -0.01) return "eroding";
  return "stable";
}

// ─── Dimension Scorers ────────────────────────────────────────────────────────

/**
 * Dimension 1: RNOA Persistence
 * Score based on: median RNOA vs kw, % of periods above kw, consistency
 */
function scoreRNOAPersistence(
  periods: RecastPeriod[],
  kw: number,
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const rnoaValues: number[] = [];

  for (const p of periods) {
    const rnoa = p.ratios?.RNOA ?? null;
    rawValues.push({ period: p.period_end, value: rnoa });
    if (rnoa != null && Number.isFinite(rnoa)) rnoaValues.push(rnoa);
  }

  const evidence: string[] = [];
  if (!rnoaValues.length) {
    return { name: "RNOA Persistence", score: 0, weight: 0.30, evidence: ["No RNOA data"], rawValues };
  }

  const medRNOA = medianOf(rnoaValues)!;
  const pctAbove = rnoaValues.filter(v => v > kw).length / rnoaValues.length;
  const sd = stdDev(rnoaValues) ?? 0;

  // Score components:
  // 1. Median RNOA vs kw: 0–50 pts
  const spreadScore = clamp((medRNOA - kw) / 0.15 * 50, 0, 50);
  // 2. % periods above kw: 0–30 pts
  const consistencyScore = pctAbove * 30;
  // 3. Low volatility bonus: 0–20 pts (lower std dev = more stable)
  const volatilityScore = clamp((1 - sd / 0.10) * 20, 0, 20);

  const score = Math.round(spreadScore + consistencyScore + volatilityScore);

  evidence.push(`Median RNOA: ${(medRNOA * 100).toFixed(1)}% vs kw: ${(kw * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctAbove * 100)}% of periods above cost of capital`);
  evidence.push(`RNOA std dev: ${(sd * 100).toFixed(1)}%`);

  return { name: "RNOA Persistence", score: clamp(score, 0, 100), weight: 0.30, evidence, rawValues };
}

/**
 * Dimension 2: SPREAD Durability
 * Score based on: median SPREAD, % of periods with positive SPREAD, SPREAD trend
 */
function scoreSPREADDurability(
  periods: RecastPeriod[],
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const spreadValues: number[] = [];

  for (const p of periods) {
    const spread = p.ratios?.SPREAD ?? null;
    rawValues.push({ period: p.period_end, value: spread });
    if (spread != null && Number.isFinite(spread)) spreadValues.push(spread);
  }

  const evidence: string[] = [];
  if (!spreadValues.length) {
    return { name: "SPREAD Durability", score: 0, weight: 0.25, evidence: ["No SPREAD data"], rawValues };
  }

  const medSpread = medianOf(spreadValues)!;
  const pctPositive = spreadValues.filter(v => v > 0).length / spreadValues.length;
  const pctStrong   = spreadValues.filter(v => v > 0.05).length / spreadValues.length;

  // Score: median SPREAD (0–40), % positive (0–35), % strong (0–25)
  const medScore    = clamp(medSpread / 0.10 * 40, 0, 40);
  const posScore    = pctPositive * 35;
  const strongScore = pctStrong * 25;

  const score = Math.round(medScore + posScore + strongScore);

  evidence.push(`Median SPREAD: ${(medSpread * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctPositive * 100)}% of periods with positive SPREAD`);
  evidence.push(`${Math.round(pctStrong * 100)}% of periods with SPREAD > 5%`);

  return { name: "SPREAD Durability", score: clamp(score, 0, 100), weight: 0.25, evidence, rawValues };
}

/**
 * Dimension 3: Margin Stability
 * Score based on: median CoreSalesPM, coefficient of variation (lower = better)
 */
function scoreMarginStability(periods: RecastPeriod[]): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const pmValues: number[] = [];

  for (const p of periods) {
    const pm = p.ratios?.CoreSalesPM ?? null;
    rawValues.push({ period: p.period_end, value: pm });
    if (pm != null && Number.isFinite(pm)) pmValues.push(pm);
  }

  const evidence: string[] = [];
  if (!pmValues.length) {
    return { name: "Margin Stability", score: 0, weight: 0.20, evidence: ["No CoreSalesPM data"], rawValues };
  }

  const medPM = medianOf(pmValues)!;
  const sd    = stdDev(pmValues) ?? 0;
  const cv    = Math.abs(medPM) > 0.001 ? sd / Math.abs(medPM) : 1;

  // Score: median PM level (0–50), stability (0–50)
  const levelScore    = clamp(medPM / 0.20 * 50, 0, 50);
  const stabilityScore = clamp((1 - cv) * 50, 0, 50);

  const score = Math.round(levelScore + stabilityScore);

  evidence.push(`Median CoreSalesPM: ${(medPM * 100).toFixed(1)}%`);
  evidence.push(`Coefficient of variation: ${(cv * 100).toFixed(0)}% (lower = more stable)`);
  if (medPM > 0.15) evidence.push("High-margin business — pricing power signal");
  if (cv < 0.15)    evidence.push("Very stable margins — durable competitive position");

  return { name: "Margin Stability", score: clamp(score, 0, 100), weight: 0.20, evidence, rawValues };
}

/**
 * Dimension 4: Reinvestment Quality
 * Score based on: incremental RNOA (ΔNOA → ΔCOREOI), ROIC on new investment
 * Incremental RNOA = ΔCoreOI / ΔNOA (year-over-year)
 */
function scoreReinvestmentQuality(
  periods: RecastPeriod[],
  kw: number,
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const incRNOAValues: number[] = [];

  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = sorted[i - 1];
    const dNOA    = (curr.bs?.NOA ?? 0) - (prev.bs?.NOA ?? 0);
    const dCoreOI = (curr.cu?.CoreOI ?? 0) - (prev.cu?.CoreOI ?? 0);

    if (Math.abs(dNOA) > 1) {  // avoid division by near-zero
      const incRNOA = dCoreOI / dNOA; // use signed dNOA to capture shrink/grow
      if (Number.isFinite(incRNOA) && Math.abs(incRNOA) < 5) {
        incRNOAValues.push(incRNOA);
        rawValues.push({ period: curr.period_end, value: incRNOA });
      } else {
        rawValues.push({ period: curr.period_end, value: null });
      }
    } else {
      rawValues.push({ period: curr.period_end, value: null });
    }
  }

  const evidence: string[] = [];
  if (!incRNOAValues.length) {
    return { name: "Reinvestment Quality", score: 50, weight: 0.15, evidence: ["Insufficient data for incremental RNOA"], rawValues };
  }

  const medIncRNOA = medianOf(incRNOAValues)!;
  const pctAbove   = incRNOAValues.filter(v => v > kw).length / incRNOAValues.length;

  // Score: median incremental RNOA vs kw (0–60), % above kw (0–40)
  const levelScore = clamp((medIncRNOA - kw) / 0.15 * 60, 0, 60);
  const pctScore   = pctAbove * 40;

  const score = Math.round(levelScore + pctScore);

  evidence.push(`Median incremental RNOA: ${(medIncRNOA * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctAbove * 100)}% of reinvestment years earned above kw`);
  if (medIncRNOA > kw * 1.5) evidence.push("Reinvestment earns well above cost of capital — compounding machine");

  return { name: "Reinvestment Quality", score: clamp(score, 0, 100), weight: 0.15, evidence, rawValues };
}

/**
 * Dimension 5: ATO Stability
 * Asset turnover stability signals operational efficiency moat.
 * Highly stable ATO = process/scale advantage.
 */
function scoreATOStability(periods: RecastPeriod[]): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const atoValues: number[] = [];

  for (const p of periods) {
    const ato = p.ratios?.ATO ?? null;
    rawValues.push({ period: p.period_end, value: ato });
    if (ato != null && Number.isFinite(ato) && ato > 0) atoValues.push(ato);
  }

  const evidence: string[] = [];
  if (!atoValues.length) {
    return { name: "ATO Stability", score: 50, weight: 0.10, evidence: ["No ATO data"], rawValues };
  }

  const medATO = medianOf(atoValues)!;
  const sd     = stdDev(atoValues) ?? 0;
  const cv     = medATO > 0 ? sd / medATO : 1;

  // Score: stability (0–70), level bonus for asset-light (0–30)
  const stabilityScore = clamp((1 - cv * 2) * 70, 0, 70);
  const levelScore     = medATO > 1.5 ? 30 : medATO > 0.8 ? 15 : 0;

  const score = Math.round(stabilityScore + levelScore);

  evidence.push(`Median ATO: ${medATO.toFixed(2)}x`);
  evidence.push(`ATO coefficient of variation: ${(cv * 100).toFixed(0)}%`);
  if (medATO > 2.0) evidence.push("High asset turnover — capital-light model");
  if (cv < 0.10)    evidence.push("Very stable asset utilization — operational moat");

  return { name: "ATO Stability", score: clamp(score, 0, 100), weight: 0.10, evidence, rawValues };
}

// ─── Moat Width Classification ────────────────────────────────────────────────

function classifyMoatWidth(
  compositeScore: number,
  periodsAboveCOC: number,
  periodsWithStrongSpread: number,
  totalPeriods: number,
): MoatWidth {
  if (totalPeriods < 3) return "insufficient-data";

  const pctAbove  = periodsAboveCOC / totalPeriods;
  const pctStrong = periodsWithStrongSpread / totalPeriods;

  if (compositeScore >= 75 && pctStrong >= 0.70) return "wide";
  if (compositeScore >= 55 && pctAbove >= 0.50)  return "narrow";
  return "none";
}

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Compute economic moat score for an industrial company.
 *
/**
 * Compute composite moat score from recast periods.
 *
 * @param periods    Sorted recast periods (oldest → newest)
 * @param config     Engine config (provides ke, kw)
 * @param kwOverride Optional structurally-derived kw to use instead of the
 *                   80/20 fallback in `deriveKwFromConfig`. v3Analytics passes
 *                   the same kw it uses for terminal-value math so the moat
 *                   score stays consistent across modules (review C8, S-9.4C).
 */
export function computeMoatScore(
  periods: RecastPeriod[],
  config: EngineConfig,
  kwOverride?: number | null,
): MoatScoreResult | null {
  if (!periods || periods.length < 3) return null;

  const notes: string[] = [];
  const kw = (kwOverride != null && Number.isFinite(kwOverride) && kwOverride > 0)
    ? kwOverride
    : deriveKwFromConfig(config);

  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  // ── Compute dimensions ───────────────────────────────────────────────────
  const d1 = scoreRNOAPersistence(sorted, kw);
  const d2 = scoreSPREADDurability(sorted);
  const d3 = scoreMarginStability(sorted);
  const d4 = scoreReinvestmentQuality(sorted, kw);
  const d5 = scoreATOStability(sorted);

  const dimensions = [d1, d2, d3, d4, d5];

  // ── Composite score (weighted average) ──────────────────────────────────
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const compositeScore = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight
  );

  // ── SPREAD statistics ────────────────────────────────────────────────────
  const spreadValues = sorted
    .map(p => p.ratios?.SPREAD)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const periodsAboveCostOfCapital = spreadValues.filter(v => v > 0).length;
  const periodsWithStrongSpread   = spreadValues.filter(v => v > 0.05).length;
  const totalPeriods = sorted.length;

  // ── RNOA series for CAP ──────────────────────────────────────────────────
  const rnoaSeries = sorted
    .map(p => p.ratios?.RNOA)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const latestRNOA = rnoaSeries.length > 0 ? rnoaSeries[rnoaSeries.length - 1] : null;
  const phi = estimatePhi(rnoaSeries);

  const cap = latestRNOA != null
    ? estimateCAP(latestRNOA, kw, phi, rnoaSeries)
    : { years: null, phi: null, latestRNOA: null, kw, confidence: "low" as const, method: "insufficient-data" as const };

  // ── Summary stats ────────────────────────────────────────────────────────
  const medianRNOA   = medianOf(rnoaSeries);
  const medianSPREAD = medianOf(spreadValues);
  const pmValues = sorted
    .map(p => p.ratios?.CoreSalesPM)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const medianCorePM = medianOf(pmValues);

  const moatWidth = classifyMoatWidth(
    compositeScore,
    periodsAboveCostOfCapital,
    periodsWithStrongSpread,
    totalPeriods,
  );

  const moatTrend = computeTrend(sorted.map(p => p.ratios?.SPREAD ?? null));

  if (rnoaSeries.length < 5) notes.push("Fewer than 5 periods with RNOA — moat assessment less reliable");
  if (phi != null && phi > 0.95) notes.push("Very high RNOA persistence (phi > 0.95) — may reflect data quality issue");

  return {
    compositeScore,
    moatWidth,
    dimensions,
    cap,
    periodsAboveCostOfCapital,
    periodsWithStrongSpread,
    totalPeriods,
    medianRNOA,
    medianSPREAD,
    medianCorePM,
    moatTrend,
    notes,
  };
}

// ─── Bank Moat ────────────────────────────────────────────────────────────────

/**
 * Compute moat score for a bank/NBFC using ROE-based analysis.
 * ROE spread = ROE − ke (analogous to RNOA − kw for industrials)
 */
export function computeBankMoatScore(
  bankMetrics: BankPeriodMetrics[],
  config: EngineConfig,
): BankMoatResult | null {
  if (!bankMetrics || bankMetrics.length < 3) return null;

  const notes: string[] = [];
  const ke = ke_from_config(config);

  const sorted = [...bankMetrics].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  const roeValues: number[] = [];
  const roeSpreadValues: number[] = [];

  for (const m of sorted) {
    if (m.roe != null && Number.isFinite(m.roe)) {
      roeValues.push(m.roe);
      roeSpreadValues.push(m.roe - ke);
    }
  }

  if (!roeValues.length) return null;

  const medianROE       = medianOf(roeValues);
  const medianROESpread = medianOf(roeSpreadValues);
  const periodsAboveKe  = roeValues.filter(v => v > ke).length;
  const totalPeriods    = sorted.length;

  // Composite score: median ROE spread (0–50), % above ke (0–30), stability (0–20)
  const spreadScore = clamp(((medianROESpread ?? 0) / 0.08) * 50, 0, 50);
  const pctScore    = (periodsAboveKe / totalPeriods) * 30;
  const sd          = stdDev(roeValues) ?? 0;
  const stabScore   = clamp((1 - sd / 0.05) * 20, 0, 20);
  const compositeScore = Math.round(spreadScore + pctScore + stabScore);

  const moatWidth = classifyMoatWidth(
    compositeScore,
    periodsAboveKe,
    roeValues.filter(v => v > ke + 0.05).length,
    totalPeriods,
  );

  // CAP for bank: use ROE series
  const phi = estimatePhi(roeValues);
  const latestROE = roeValues[roeValues.length - 1];
  const cap = estimateCAP(latestROE, ke, phi, roeValues);

  const moatTrend = computeTrend(roeSpreadValues);

  if (roeValues.length < 5) notes.push("Fewer than 5 periods with ROE — bank moat assessment less reliable");

  return {
    compositeScore: clamp(compositeScore, 0, 100),
    moatWidth,
    medianROE,
    medianROESpread,
    periodsAboveKe,
    totalPeriods,
    cap,
    moatTrend,
    notes,
  };
}
