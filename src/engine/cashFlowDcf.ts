/* ================================================================
   Cash-lens FCFF DCF — an INDEPENDENT valuation paradigm.

   Poly-paradigm thesis (docs/poly-paradigm-valuation-plan.md §1): the
   engine's headline "six-model triangulation" (RE, ReOI, FCFF, FCFE, AEG,
   DDM) is the SAME Penman-Nissim residual-income recast rearranged six
   ways — under clean surplus RE≡FCFE and ReOI≡FCFF≡AEG, so they cannot
   genuinely disagree. The recast computes FCF_cash = CFO − Capex per period
   (recast.ts:346) but NOTHING ever discounts it into a value.

   This lens closes that gap: a forward FCFF DCF built DIRECTLY from the
   cash-flow statement (cf.FCF_cash), discounted at the structural kw, with
   an enterprise→equity bridge of −NFO −MI. It does NOT read NOA/OI/CNI, so
   it is a genuinely independent leg the cross-paradigm reconciliation gate
   (Phase 1.2) can let DISAGREE with the accrual lens.

   Discounting note: FCFF is a pre-financing (whole-entity) stream, so it is
   discounted at kw (WACC) to an enterprise value, then bridged to common
   equity by subtracting net debt (NFO) AND minority interest (MI) — the
   same bridge discipline as the #87 minority-interest fix.
================================================================ */

import { RecastPeriod, EngineConfig, resolveKw } from "./types";

const MIN_TERMINAL_SPREAD = 0.005;

export interface CashFlowDcfResult {
  /** Enterprise value from discounting the projected FCFF stream at kw. */
  enterpriseValue: number;
  /** Common-equity value = EV − NFO − MI (anchor period). */
  equityValue: number;
  /** Per-share intrinsic value, or null when shares are unavailable. */
  perShare: number | null;
  /** Normalized base FCF_cash the projection grew from (median of window). */
  baseFcf: number;
  /** kw used to discount (structural, via resolveKw). */
  kw: number;
  /** Terminal growth applied. */
  terminalGrowth: number;
  /** Number of historical periods the normalized base drew from. */
  windowPeriods: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Forward FCFF DCF from the cash-flow statement, independent of the recast's
 * NOA/OI accrual reformulation.
 *
 * A non-positive normalized base is valued, not skipped: the cash statement
 * says the business consumed cash over the window, and the equity comes out
 * at or below the bridge. That is the lens's evidence, and the triangulation
 * compares a value below zero as ₹0 (#401).
 *
 * Returns null (honest skip, never a misleading zero) when:
 *  - fewer than 2 periods (no defensible normalized base), or
 *  - kw is non-finite/non-positive, or
 *  - terminal economics fail the minimum positive kw minus growth spread.
 *
 * @param periods   recast periods, chronological (oldest → newest).
 * @param config    engine config (for resolveKw fallback + risk-free floor).
 * @param shares    shares outstanding (Cr) for the per-share figure, or null.
 * @param opts.terminalGrowth  long-run FCF growth (default 0.03).
 * @param opts.nearTermGrowth  Y1..horizon growth before fade (default 0.06).
 * @param opts.horizon         explicit forecast years (default 5).
 * @param opts.fadeAlpha       persistence of near-term growth toward terminal (default 0.6).
 * @param opts.window          # of trailing periods to normalize the base over (default 5).
 */
export function computeCashFlowDcf(
  periods: RecastPeriod[],
  config: EngineConfig,
  shares: number | null,
  opts?: {
    terminalGrowth?: number;
    nearTermGrowth?: number;
    horizon?: number;
    fadeAlpha?: number;
    window?: number;
    /** The run's operating capital cost, when the valuation has settled one (S-9.4C). */
    kw?: number | null;
    /** The minority claim the accrual bridge subtracts (its value, not its book), when there is one. */
    minorityClaim?: number | null;
  },
): CashFlowDcfResult | null {
  if (!periods || periods.length < 2) return null;

  const terminalGrowth = opts?.terminalGrowth ?? 0.03;
  const nearTermGrowth = opts?.nearTermGrowth ?? 0.06;
  const horizon = opts?.horizon ?? 5;
  const fadeAlpha = opts?.fadeAlpha ?? 0.6;
  const window = opts?.window ?? 5;

  const latest = periods[periods.length - 1]!;
  const { kw } = resolveKw(latest.kwStructural, config, { override: opts?.kw ?? null });
  if (!Number.isFinite(kw) || kw <= 0) return null;
  // A zero terminal value is not a valid substitute for invalid Gordon
  // economics. Fail closed so this lens is excluded from synthesis and model
  // counts through the existing honest-null contract.
  if (!Number.isFinite(terminalGrowth) || kw - terminalGrowth <= MIN_TERMINAL_SPREAD) return null;

  // Normalized base: median of trailing FCF_cash to damp single-year noise.
  // FCF_cash = CFO − Capex is already sign-correct per period (recast.ts:346).
  const windowFcf = periods
    .slice(-window)
    .map((p) => p.cf.FCF_cash)
    .filter((v): v is number => Number.isFinite(v));
  if (windowFcf.length < 2) return null;
  // A non-positive base is not skipped. The skip was for a gate that read a
  // value below zero as absent; since #401 it compares it as ₹0, the widest
  // disagreement. Skipping it let a company whose trailing cash flow is
  // negative (DMart: median −₹654 Cr over FY21–FY25) clear the cross-check
  // that one with a small positive flow (NTPC, Reliance) fails.
  const baseFcf = median(windowFcf);

  // Growth path: near-term growth fading geometrically toward terminal.
  const growthPath: number[] = [];
  let g = nearTermGrowth;
  for (let i = 0; i < horizon; i += 1) {
    growthPath.push(g);
    g = fadeAlpha * g + (1 - fadeAlpha) * terminalGrowth;
  }

  // Project and discount the explicit FCFF stream at kw.
  let current = baseFcf;
  const projected = growthPath.map((rate) => {
    current *= 1 + rate;
    return current;
  });
  const pvExplicit = projected.reduce(
    (sum, value, i) => sum + value / Math.pow(1 + kw, i + 1),
    0,
  );

  // Terminal (Gordon) value. The kw − g guard above ensures this calculation
  // cannot silently collapse to zero or blow up on invalid economics.
  const lastFcf = projected[projected.length - 1]!;
  const terminalValue = (lastFcf * (1 + terminalGrowth)) / (kw - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + kw, horizon);

  const enterpriseValue = pvExplicit + pvTerminal;
  // Enterprise → common equity: subtract net debt (NFO) and the minority claim
  // — at the value the accrual bridge uses when it settled one, so the two
  // lenses differ in their flows, not in how they split the enterprise.
  const minorityClaim = opts?.minorityClaim != null && Number.isFinite(opts.minorityClaim) ? opts.minorityClaim : latest.bs.MI;
  // Plus a carved lending-arm stake at value, as the accrual bridge adds it.
  const equityValue = enterpriseValue - latest.bs.NFO - minorityClaim + (latest.bs.CarvedArmStakeValue ?? 0);
  const perShare = shares != null && shares > 0 ? equityValue / shares : null;

  return {
    enterpriseValue,
    equityValue,
    perShare,
    baseFcf,
    kw,
    terminalGrowth,
    windowPeriods: windowFcf.length,
  };
}
