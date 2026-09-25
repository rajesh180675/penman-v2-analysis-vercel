/**
 * Self-consistent residual-operating-income valuation.
 *
 * Built from first principles rather than on the shared forecast path, so it
 * is an independent triangulation point:
 *
 *  1. ANCHOR — today's balance sheet: NOA₀, NFO₀, MI₀.
 *
 *  2. FADE — Nissim & Penman (2001): abnormal operating profitability decays.
 *     The spread of core RNOA over kw starts at today's level and fades
 *     geometrically at persistence ω, estimated by AR(1) on the firm's own
 *     core-RNOA history and shrunk toward a 0.7 prior in proportion to how
 *     little history there is. NOA growth fades from its recent rate to g.
 *
 *       ReOI_t = s₀ ω^(t−1) · NOA_(t−1)
 *       CV_N   = s₀ ω^N · NOA_N / (1 + kw − ω(1+g))      (persistence form)
 *       V_op   = NOA₀ + Σ ReOI_t/(1+kw)^t + CV_N/(1+kw)^N
 *       V_E    = V_op − NFO₀ − MI₀
 *
 *  3. KW BY VALUE WEIGHTS — the part the shared path does not do. The
 *     operating cost of capital is the value-weighted mix the equity cost is a
 *     blend of (Modigliani–Miller):
 *
 *       kw = (ke·(V_E + MI) + kd·NFO) / V_op
 *
 *     deriveKwFromStructure applies this on BOOK weights. For a firm with
 *     P/B ≫ 1 and a large net-cash position that is badly wrong: ITC's book
 *     weights put 3.1× of its equity on ₹22k Cr of operating assets and give
 *     kw ≈ 30%, so its RE and ReOI valuations disagreed by ~60% on the same
 *     forecast. Here V_E depends on kw and kw on V_E, so the pair is solved
 *     jointly by damped fixed-point iteration. Non-convergence, a non-positive
 *     value, or ke ≤ g fails closed with a reason instead of printing a number.
 */
import { estimateArPhi } from "../PenmanNissimEngine";
import type { RecastPeriod } from "../types";
import {
  SELF_CONSISTENT_VALUATION_MODEL_VERSION,
  type KdSource,
  type OmegaSource,
  type SelfConsistentForecastYear,
  type SelfConsistentSensitivityCell,
  type SelfConsistentValuationInput,
  type SelfConsistentValuationResult,
} from "./types";

const DEFAULT_HORIZON = 10;
const OMEGA_PRIOR = 0.7;
/** Pseudo-observations behind the prior: 5 years of history weighs as much as it. */
const OMEGA_PRIOR_WEIGHT = 5;
const OMEGA_MIN = 0.3;
const OMEGA_MAX = 0.92;
const GROWTH_FADE = 0.7;
const KW_MIN = 0.01;
const KW_MAX = 0.6;
const FIXED_POINT_TOLERANCE = 1e-7;
const FIXED_POINT_MAX_ITERATIONS = 200;
const FIXED_POINT_DAMPING = 0.5;
const MIN_TERMINAL_DENOMINATOR = 0.01;

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function skip(reason: string): SelfConsistentValuationResult {
  return { status: "skipped", modelVersion: SELF_CONSISTENT_VALUATION_MODEL_VERSION, reason };
}

/** Core RNOA per period (CoreOI over average NOA, strips unusual items), keyed by period end. */
function coreRnoaSeries(history: readonly RecastPeriod[]): Array<{ periodEnd: string; rnoa: number }> {
  const out: Array<{ periodEnd: string; rnoa: number }> = [];
  for (let i = 1; i < history.length; i++) {
    const avgNoa = (history[i]!.bs.NOA + history[i - 1]!.bs.NOA) / 2;
    const coreOI = history[i]!.cu?.CoreOI ?? history[i]!.is.OI;
    if (avgNoa > 0 && Number.isFinite(coreOI)) out.push({ periodEnd: history[i]!.period_end, rnoa: coreOI / avgNoa });
  }
  return out;
}

/** Fewest post-break observations worth estimating persistence on. */
const MIN_POST_BREAK_POINTS = 4;

/**
 * Persistence of core RNOA.
 *
 * Two corrections before shrinking toward the prior, both standard:
 *  - Kendall (1954) small-sample bias: OLS AR(1) is biased down by about
 *    (1 + 3φ)/n, which on the 8–15 annual points available here is large.
 *    Inverting E[φ̂] ≈ φ − (1 + 3φ)/n gives φ = (nφ̂ + 1)/(n − 3).
 *  - Structural breaks: a merger or accounting change steps NOA, which an
 *    AR(1) reads as low persistence (HUL's 2020 GSK Consumer merger did this).
 *    When break periods are known and enough history follows the last one,
 *    only the post-break window is used.
 */
export function estimateSpreadPersistence(
  rnoaSeries: readonly number[],
): { omega: number; raw: number | null; source: OmegaSource; observations: number } {
  const observations = Math.max(0, rnoaSeries.length - 1);
  if (rnoaSeries.length < 3) return { omega: OMEGA_PRIOR, raw: null, source: "prior", observations };
  const raw = estimateArPhi([...rnoaSeries]).phi;
  const biasCorrected = observations > 3 ? (observations * raw + 1) / (observations - 3) : raw;
  const bounded = clamp(biasCorrected, 0, 0.98);
  const shrunk = (observations * bounded + OMEGA_PRIOR_WEIGHT * OMEGA_PRIOR) / (observations + OMEGA_PRIOR_WEIGHT);
  return { omega: clamp(shrunk, OMEGA_MIN, OMEGA_MAX), raw, source: "company-shrunk", observations };
}

function postBreakWindow(
  series: ReadonlyArray<{ periodEnd: string; rnoa: number }>,
  breakPeriods: readonly string[] | undefined,
): { values: number[]; usedBreak: string | null } {
  const all = series.map((point) => point.rnoa);
  if (!breakPeriods?.length) return { values: all, usedBreak: null };
  const lastBreak = [...breakPeriods].sort().at(-1)!;
  const after = series.filter((point) => point.periodEnd > lastBreak).map((point) => point.rnoa);
  return after.length >= MIN_POST_BREAK_POINTS ? { values: after, usedBreak: lastBreak } : { values: all, usedBreak: null };
}

export interface ValuationAnchor {
  periodEnd: string;
  noa: number;
  nfo: number;
  mi: number;
  cse: number;
  rnoa0: number;
  growth0: number;
}

interface OperatingValue {
  operatingValue: number;
  pvExplicit: number;
  pvTerminal: number;
  forecast: SelfConsistentForecastYear[];
}

/** V_op for a given kw and ω. Pure — the fixed point calls it repeatedly. */
export function operatingValueAt(anchor: ValuationAnchor, kw: number, omega: number, g: number, horizon: number): OperatingValue | null {
  const denominator = 1 + kw - omega * (1 + g);
  if (!(denominator > MIN_TERMINAL_DENOMINATOR) || !(kw > g)) return null;
  const spread0 = anchor.rnoa0 - kw;
  const baseYear = Number(anchor.periodEnd.slice(0, 4));
  const suffix = anchor.periodEnd.slice(4);
  let noa = anchor.noa;
  let pvExplicit = 0;
  const forecast: SelfConsistentForecastYear[] = [];
  for (let t = 1; t <= horizon; t++) {
    const spread = spread0 * omega ** (t - 1);
    const reoi = spread * noa;
    const presentValue = reoi / (1 + kw) ** t;
    pvExplicit += presentValue;
    forecast.push({ year: t, periodEnd: `${baseYear + t}${suffix}`, noaOpening: noa, rnoa: kw + spread, spread, reoi, presentValue });
    const growth = g + (anchor.growth0 - g) * GROWTH_FADE ** t;
    noa *= 1 + growth;
  }
  const continuingValue = (spread0 * omega ** horizon * noa) / denominator;
  const pvTerminal = continuingValue / (1 + kw) ** horizon;
  return { operatingValue: anchor.noa + pvExplicit + pvTerminal, pvExplicit, pvTerminal, forecast };
}

/** kw on the weights of a given equity value. */
function valueWeightedKw(anchor: ValuationAnchor, ke: number, kd: number, equityValue: number): number | null {
  const operating = equityValue + anchor.mi + anchor.nfo;
  if (!(operating > 0)) return null;
  return (ke * (equityValue + anchor.mi) + kd * anchor.nfo) / operating;
}

interface Solution {
  kw: number;
  iterations: number;
  value: OperatingValue;
  equityValue: number;
  atBound: boolean;
}

/** Solve kw and V_E jointly. Null with a reason when there is no admissible fixed point. */
export function solveValueWeightedKw(
  anchor: ValuationAnchor,
  ke: number,
  kd: number,
  g: number,
  omega: number,
  horizon: number,
): Solution | { failure: string } {
  // Start from book weights — what the rest of the engine uses.
  let kw = clamp(valueWeightedKw(anchor, ke, kd, anchor.cse) ?? ke, KW_MIN, KW_MAX);
  for (let iteration = 1; iteration <= FIXED_POINT_MAX_ITERATIONS; iteration++) {
    const value = operatingValueAt(anchor, kw, omega, g, horizon);
    if (!value) return { failure: `kw ${(kw * 100).toFixed(2)}% does not exceed terminal growth enough for a finite continuing value.` };
    const equityValue = value.operatingValue - anchor.nfo - anchor.mi;
    if (!(equityValue > 0)) {
      return { failure: "Equity value is not positive at the candidate kw, so value weights are undefined." };
    }
    const target = valueWeightedKw(anchor, ke, kd, equityValue);
    if (target == null) return { failure: "Operating value is not positive, so value weights are undefined." };
    const next = clamp((1 - FIXED_POINT_DAMPING) * kw + FIXED_POINT_DAMPING * target, KW_MIN, KW_MAX);
    if (Math.abs(next - kw) < FIXED_POINT_TOLERANCE) {
      const settled = operatingValueAt(anchor, next, omega, g, horizon);
      if (!settled) return { failure: "Converged kw leaves no finite continuing value." };
      return {
        kw: next,
        iterations: iteration,
        value: settled,
        equityValue: settled.operatingValue - anchor.nfo - anchor.mi,
        atBound: next === KW_MIN || next === KW_MAX,
      };
    }
    kw = next;
  }
  return { failure: `kw did not converge within ${FIXED_POINT_MAX_ITERATIONS} iterations.` };
}

function resolveKd(latest: RecastPeriod, fallback: number): { kd: number; source: KdSource } {
  const nfo = latest.bs.NFO;
  if (Math.abs(nfo) > 1) {
    // Signed ratio: for net cash both NFE and NFO are negative, giving the
    // positive yield on financial assets.
    const ratio = latest.is.NFE / nfo;
    if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 0.2) return { kd: ratio, source: "reported-nfe-over-nfo" };
  }
  return { kd: fallback, source: "fallback" };
}

export function computeSelfConsistentValuation(input: SelfConsistentValuationInput): SelfConsistentValuationResult {
  const history = input.history;
  const horizon = input.horizon ?? DEFAULT_HORIZON;
  if (history.length < 2) return skip("Needs at least two recast periods to measure current core RNOA.");
  if (!(input.ke - input.g > 0.005)) return skip("Cost of equity must exceed terminal growth by at least 0.5pp.");
  const latest = history[history.length - 1]!;
  if (!(latest.bs.NOA > 0)) {
    return skip("Net operating assets are not positive; an operating-asset valuation is undefined (use the equity-side or loss-maker lenses).");
  }

  const rnoaPoints = coreRnoaSeries(history);
  if (!rnoaPoints.length) return skip("Core RNOA could not be measured on the available history.");
  const rnoaSeries = rnoaPoints.map((point) => point.rnoa);
  // Current profitability: average of the last two core RNOAs, damping a
  // one-year spike without reaching back into stale history.
  const rnoa0 = rnoaSeries.slice(-2).reduce((sum, value) => sum + value, 0) / Math.min(2, rnoaSeries.length);
  const noaGrowth = history.slice(-4).flatMap((period, index, window) => {
    if (index === 0) return [];
    const previous = window[index - 1]!.bs.NOA;
    return previous > 0 ? [(period.bs.NOA - previous) / previous] : [];
  });
  const growth0 = clamp(median(noaGrowth) ?? input.g, -0.1, 0.3);
  const window = postBreakWindow(rnoaPoints, input.structuralBreakPeriods);
  const persistence = estimateSpreadPersistence(window.values);
  const { kd, source: kdSource } = resolveKd(latest, input.kdFallback);
  const anchor: ValuationAnchor = {
    periodEnd: latest.period_end,
    noa: latest.bs.NOA,
    nfo: latest.bs.NFO,
    mi: Number.isFinite(latest.bs.MI) ? latest.bs.MI : 0,
    cse: latest.bs.CSE,
    rnoa0,
    growth0,
  };

  const solution = solveValueWeightedKw(anchor, input.ke, kd, input.g, persistence.omega, horizon);
  if ("failure" in solution) return skip(solution.failure);

  const warnings: string[] = [];
  if (persistence.source === "prior") warnings.push(`Fewer than 3 core-RNOA observations: persistence uses the ${OMEGA_PRIOR} prior.`);
  if (window.usedBreak) warnings.push(`Persistence estimated on the ${window.values.length} years after the ${window.usedBreak} structural break.`);
  if (solution.atBound) warnings.push(`kw settled at its ${(KW_MIN * 100).toFixed(0)}–${(KW_MAX * 100).toFixed(0)}% safety bound; treat the value as indicative.`);
  const spread0 = rnoa0 - solution.kw;
  if (spread0 < 0) warnings.push("Current core RNOA is below kw: the model values the firm below book NOA as the negative spread fades.");
  if (kdSource === "fallback") warnings.push("Reported NFE/NFO was unusable; kd uses the configured after-tax cost of debt.");

  const bookKw = valueWeightedKw(anchor, input.ke, kd, anchor.cse);
  const shares = input.shares != null && input.shares > 0 ? input.shares : null;
  const price = input.marketPrice != null && input.marketPrice > 0 ? input.marketPrice : null;
  const marketCap = shares != null && price != null ? shares * price : null;
  const marketKw = marketCap != null ? valueWeightedKw(anchor, input.ke, kd, marketCap) : null;
  const perShare = shares != null ? solution.equityValue / shares : null;

  const sensitivity: SelfConsistentSensitivityCell[] = [];
  for (const ke of [input.ke - 0.01, input.ke, input.ke + 0.01]) {
    for (const omega of [persistence.omega - 0.1, persistence.omega, persistence.omega + 0.1].map((w) => clamp(w, 0, 0.95))) {
      const cell = ke - input.g > 0.005 ? solveValueWeightedKw(anchor, ke, kd, input.g, omega, horizon) : { failure: "ke ≤ g" };
      const ok = !("failure" in cell);
      sensitivity.push({
        ke,
        omega,
        kw: ok ? cell.kw : null,
        equityValue: ok ? cell.equityValue : null,
        perShare: ok && shares != null ? cell.equityValue / shares : null,
      });
    }
  }

  // How persistent must the spread be for the model to reach market cap?
  let marketImpliedOmega: number | null = null;
  if (marketCap != null) {
    const kwForMarket = marketKw ?? solution.kw;
    const equityAt = (omega: number) => {
      const value = operatingValueAt(anchor, kwForMarket, omega, input.g, horizon);
      return value ? value.operatingValue - anchor.nfo - anchor.mi : null;
    };
    const lo = equityAt(0);
    const hi = equityAt(0.98);
    if (lo != null && hi != null && (lo - marketCap) * (hi - marketCap) <= 0) {
      let a = 0;
      let b = 0.98;
      for (let i = 0; i < 80; i++) {
        const mid = (a + b) / 2;
        const value = equityAt(mid);
        if (value == null) break;
        if ((value - marketCap) * (lo - marketCap) > 0) a = mid;
        else b = mid;
      }
      marketImpliedOmega = (a + b) / 2;
    }
  }

  const { value } = solution;
  return {
    status: "ok",
    modelVersion: SELF_CONSISTENT_VALUATION_MODEL_VERSION,
    anchorPeriod: latest.period_end,
    equityValue: solution.equityValue,
    operatingValue: value.operatingValue,
    perShare,
    marginOfSafety: perShare != null && price != null ? (perShare - price) / price : null,
    kw: {
      intrinsic: solution.kw,
      book: bookKw ?? Number.NaN,
      market: marketKw,
      kd,
      kdSource,
      iterations: solution.iterations,
    },
    fade: {
      omega: persistence.omega,
      omegaSource: persistence.source,
      omegaRaw: persistence.raw,
      observations: persistence.observations,
      rnoa0,
      spread0,
      growth0,
    },
    decomposition: {
      noa: anchor.noa,
      pvExplicitReOI: value.pvExplicit,
      pvTerminalReOI: value.pvTerminal,
      nfo: anchor.nfo,
      minorityInterest: anchor.mi,
      franchiseValue: value.operatingValue - anchor.noa,
      terminalShare: value.operatingValue !== 0 ? value.pvTerminal / value.operatingValue : 0,
    },
    forecast: value.forecast,
    sensitivity,
    marketImpliedOmega,
    warnings,
  };
}
