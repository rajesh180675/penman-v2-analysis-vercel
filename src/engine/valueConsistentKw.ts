import { computeValuation } from "./PenmanNissimEngine";
import type { LegacyValuationPeriodInput } from "./forecastState/legacyAdapter";
import type { EngineConfig } from "./types";

/**
 * How the operating discount rate behind a forecast's ReOI value was set.
 *
 * Residual earnings at ke and residual operating income at kw value the same
 * forecast identically (Penman) only when kw is the value-weighted blend of
 * the equity and net-debt costs (Modigliani–Miller) and the debt cost is the
 * forecast's own financing return. The structural kw weights by book values
 * and prices debt at the borrowing rate; on a high-P/B or net-cash firm both
 * diverge, and RE and ReOI disagreed by 30–66% on one forecast (TCS, Infosys,
 * Titan, M&M). Solved here, 17 of 19 library companies agree within 25% and
 * 15 within 10%, against 9 and 5 on the structural kw.
 */
export interface KwConsistency {
  /** The structural (book-weighted) kw the solve started from. */
  readonly kwStructural: number;
  /** The kw the ReOI value uses: solved, or the structural kw when the solve did not apply. */
  readonly kw: number;
  /** The forecast's after-tax net borrowing cost (NFE / NFO), the debt cost on value weights. */
  readonly kd: number | null;
  readonly method: "value-consistent" | "structural";
  /** Why the structural kw was kept, when it was. */
  readonly reason: string | null;
}

const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-7;
/** Above the terminal growth by at least this much, or the Gordon value is undefined. */
const MIN_SPREAD_OVER_G = 0.005;

/**
 * Solve kw = (ke·(V_E + MI₀) + kd·NFO₀) / (V_E + MI₀ + NFO₀) jointly with the
 * ReOI equity value V_E, by damped (½) fixed-point iteration from the
 * structural kw. Keeps the structural kw, and says why, when the inputs leave
 * the solve undefined.
 */
export function solveValueConsistentKw(
  periods: readonly LegacyValuationPeriodInput[],
  ke: number,
  kwStructural: number,
  g: number,
  cfg: EngineConfig,
  kd: number | null | undefined,
): KwConsistency {
  const keep = (reason: string): KwConsistency => ({ kwStructural, kw: kwStructural, kd: kd ?? null, method: "structural", reason });
  if (kd == null || !Number.isFinite(kd)) return keep("The forecast carries no net borrowing cost.");
  if (periods.length < 2) return keep("No forecast years to value.");
  const NFO = periods[0]!.bs.NFO;

  let kw = kwStructural;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const valuation = computeValuation(periods, ke, kw, g, cfg);
    // The claims on NOA alone: a carved lending-arm stake is added to the
    // equity value outside NOA, so it is no part of what kw discounts.
    const equity = valuation.V_ReOI_CV03 == null ? null : valuation.V_ReOI_CV03 - valuation.carvedArmStake;
    // Weighted at the same minority claim the equity bridge subtracts.
    const MI = valuation.minorityClaim;
    if (equity == null || !Number.isFinite(equity)) return keep("The ReOI continuing value is undefined at this kw.");
    const operatingValue = equity + MI + NFO;
    if (!(operatingValue > 0)) return keep("The operating value is not positive, so it cannot weight the costs.");
    const target = (ke * (equity + MI) + kd * NFO) / operatingValue;
    const next = 0.5 * kw + 0.5 * target;
    if (!Number.isFinite(next) || next <= g + MIN_SPREAD_OVER_G) {
      return keep("The value-weighted kw falls to the terminal growth rate.");
    }
    if (Math.abs(next - kw) < TOLERANCE) {
      return { kwStructural, kw: next, kd, method: "value-consistent", reason: null };
    }
    kw = next;
  }
  return keep("The value-weighted kw did not converge.");
}

/**
 * Value a forecast at its value-consistent kw: the solve, then the valuation
 * at the kw it settled on. Every headline path that values a forecast
 * scenario goes through here, so RE and ReOI agree wherever it is shown.
 */
export function computeConsistentValuation(
  periods: readonly LegacyValuationPeriodInput[],
  ke: number,
  kwStructural: number,
  g: number,
  cfg: EngineConfig,
  kd: number | null | undefined,
): { readonly valuation: ReturnType<typeof computeValuation>; readonly kwConsistency: KwConsistency } {
  const kwConsistency = solveValueConsistentKw(periods, ke, kwStructural, g, cfg, kd);
  return { valuation: computeValuation(periods, ke, kwConsistency.kw, g, cfg), kwConsistency };
}

/**
 * Value a non-base scenario at the base case's kw: its structural kw moved by
 * the same amount the base case's solve moved the base's. One discount rate
 * across scenarios keeps them ordered by their forecasts alone.
 */
export function heldAtBaseKw(
  periods: readonly LegacyValuationPeriodInput[],
  scenario: { readonly drivers: { readonly ke: number; readonly kw: number } },
  g: number,
  cfg: EngineConfig,
  base: KwConsistency,
): { readonly valuation: ReturnType<typeof computeValuation>; readonly kwConsistency: KwConsistency } {
  const kw = scenario.drivers.kw + (base.kw - base.kwStructural);
  const kwConsistency: KwConsistency = {
    kwStructural: scenario.drivers.kw,
    kw,
    kd: base.kd,
    method: base.method,
    reason: base.method === "value-consistent" ? "Held at the base case's value-consistent kw." : base.reason,
  };
  return { valuation: computeValuation(periods, scenario.drivers.ke, kw, g, cfg), kwConsistency };
}
