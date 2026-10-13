/**
 * "What would change our mind": for the base scenario's key drivers, the value
 * at which the base-case intrinsic value equals the market price.
 *
 * Each driver is moved on its own, everything else held: a parallel shift of
 * the whole sales-growth or core-margin path, a different cost of equity
 * (with kw following structurally, S-9.4C), or a different terminal growth.
 * Terminal growth is the driver the price leans on most, and the one its own
 * rule bounds: below the discount rates, where a continuing value exists at
 * all (2026-10: HUL's price needs 8.2% where the base case holds 5.0%; Titan's
 * is reached by no growth below them). The base card is re-valued along
 * EXACTLY the path behind the value it displays — buildScenarioCards' forecast
 * and valuation, then primaryValuationPerShare (the RE/ReOI median; the
 * owner-earnings DCF is not part of the displayed value) —
 * so with no shift this reproduces the card's intrinsic value, which the tests
 * pin.
 */
import { buildScenario, buildValuationPeriodsFromForecast } from "../forecastingEngine";
import { computeConsistentValuation } from "../valueConsistentKw";
import { structuralKwForKe } from "../pvre/pvreEngine";
import type { ForecastPeriod, ForecastScenario } from "../types";
import { carryValueToPriceDate, forecastDividendsPerShare, primaryValuationPerShare } from "./helpers";
import type { ValuationCommandCenterOutput } from "./types";

export type BreakEvenDriver = "sales_growth" | "core_sales_pm" | "ke" | "g";

export interface BreakEvenResult {
  readonly driver: BreakEvenDriver;
  /** The base case's value: year-1 sales growth / core margin, ke, or terminal growth. */
  readonly base: number;
  /** The driver value at which base-case value = price, in the same terms as `base`. */
  readonly breakEven: number | null;
  /** Why `breakEven` is null. */
  readonly reason: "no-price" | "no-base-value" | "beyond-range" | null;
}

/** How far each driver is searched from its base value. */
const SEARCH = {
  sales_growth: { lo: -0.25, hi: 0.25 },
  core_sales_pm: { lo: -0.25, hi: 0.25 },
  ke: { lo: -0.06, hi: 0.15 },
  // Up to the discount rates: the pull-in stops at the last terminal growth that values.
  g: { lo: -0.05, hi: 0.15 },
} as const;

type CommandCenterLike = Pick<ValuationCommandCenterOutput, "scenarios" | "anchorPeriod" | "shareBasis" | "marketPrice" | "marketContext">;

/**
 * Shifts to the base case, each optional: a parallel shift of the whole
 * sales-growth or core-margin path, a change in ke (kw follows structurally,
 * S-9.4C), and a change in terminal growth.
 */
export interface BaseCaseShifts {
  readonly sales_growth?: number | undefined;
  readonly core_sales_pm?: number | undefined;
  readonly ke?: number | undefined;
  readonly g?: number | undefined;
}

export interface BaseCaseRevaluation {
  /** Intrinsic value per share at the valuation date, as the base card's `intrinsicPerShare`; null when not computable. */
  readonly value: number | null;
  /** The same value carried to the price's date, as the base card's `valueAtPriceDate`: what meets the price. */
  readonly valueAtPriceDate: number | null;
  /** The forecast years behind it; null when the scenario could not be built. */
  readonly forecast: readonly ForecastPeriod[] | null;
  readonly ke: number;
  readonly kw: number;
  readonly g: number;
}

/**
 * Re-value the base case with the given shifts, along exactly the path behind
 * the base card's displayed value. With no shifts it reproduces the card.
 */
export function revalueBase(cc: CommandCenterLike, shifts: BaseCaseShifts = {}): BaseCaseRevaluation | null {
  const card = cc.scenarios.find((s) => s.key === "base");
  if (!card?.scenario?.drivers) return null;
  const latest = cc.anchorPeriod;
  const d = card.scenario.drivers;
  const g = card.assumptions.g + (shifts.g ?? 0);
  const ke = d.ke + (shifts.ke ?? 0);
  // The card's kw is value-consistent; the structural kw it was solved from
  // is what moves with ke (S-9.4C), and each re-valuation solves again from it.
  const kwStructuralBase = card.kwConsistency?.kwStructural ?? d.kw;
  const kwSeed = shifts.ke ? structuralKwForKe(ke, { ke: d.ke, kw: kwStructuralBase }, latest) : kwStructuralBase;
  const none = { value: null, valueAtPriceDate: null, forecast: null, ke, kw: kwSeed, g };
  if (!(ke - g > 0.005) || !(kwSeed - g > 0.005)) return none;
  const scenario: ForecastScenario = {
    ...card.scenario,
    drivers: {
      ...d,
      sales_growth: shifts.sales_growth ? d.sales_growth.map((v) => v + shifts.sales_growth!) : d.sales_growth,
      core_sales_pm: shifts.core_sales_pm ? d.core_sales_pm.map((v) => v + shifts.core_sales_pm!) : d.core_sales_pm,
      g_terminal: g,
      ke,
      kw: kwSeed,
    },
  };
  try {
    // Anchored at `latest`: the valuation date is the anchor period, as in buildScenarioCards.
    const { valuation, kwConsistency } = computeConsistentValuation(
      buildValuationPeriodsFromForecast(latest, buildScenario(scenario, latest)),
      ke, kwSeed, g, cc.shareBasis.valuationConfig, d.nbc[0],
    );
    const kw = kwConsistency.kw;
    const periods = buildScenario({ ...scenario, drivers: { ...scenario.drivers, kw } }, latest);
    const value = primaryValuationPerShare(valuation);
    const finite = value != null && Number.isFinite(value) ? value : null;
    const shares = cc.shareBasis.sharesForPerShare ?? cc.shareBasis.shares ?? null;
    const carried = carryValueToPriceDate(finite, ke, cc.marketContext.yearsToPriceDate, forecastDividendsPerShare(periods, latest.bs.CSE, shares));
    const change = cc.marketContext.shareCountChange;
    const valueAtPriceDate = carried != null && change != null ? carried / change : carried;
    return { value: finite, valueAtPriceDate, forecast: periods, ke, kw, g };
  } catch {
    return none;
  }
}

/** Base-case value per share at the price's date with one driver shifted by `delta`: what the price is solved against. */
export function baseValueWithShift(cc: CommandCenterLike, driver: BreakEvenDriver, delta: number): number | null {
  return revalueBase(cc, { [driver]: delta })?.valueAtPriceDate ?? null;
}

function baseDriverValue(cc: CommandCenterLike, driver: BreakEvenDriver): number | null {
  const card = cc.scenarios.find((s) => s.key === "base");
  const d = card?.scenario?.drivers;
  if (!card || !d) return null;
  // revalueBase shifts the card's terminal growth, so that is the base it is read against.
  if (driver === "g") return card.assumptions.g;
  return driver === "ke" ? d.ke : driver === "sales_growth" ? d.sales_growth[0] ?? null : d.core_sales_pm[0] ?? null;
}

/** Break-even for one driver, by bisection on the shift. */
export function solveBreakEven(cc: CommandCenterLike, driver: BreakEvenDriver): BreakEvenResult {
  const base = baseDriverValue(cc, driver) ?? Number.NaN;
  const price = cc.marketPrice;
  if (price == null || !(price > 0)) return { driver, base, breakEven: null, reason: "no-price" };
  if (baseValueWithShift(cc, driver, 0) == null) return { driver, base, breakEven: null, reason: "no-base-value" };

  const gap = (delta: number) => {
    const value = baseValueWithShift(cc, driver, delta);
    return value == null ? null : value - price;
  };
  let lo: number = SEARCH[driver].lo;
  let hi: number = SEARCH[driver].hi;
  let gLo = gap(lo);
  let gHi = gap(hi);
  // Pull an invalid end (e.g. ke at or below terminal growth) in to the edge of
  // the shifts that value; zero values (checked above). Halving the end could
  // jump past the edge, and the break-even with it: the shifts beside the
  // discount rates, where the continuing value climbs steepest, were never tried.
  const edge = (invalid: number) => {
    let valid = 0;
    for (let i = 0; i < 30; i++) {
      const mid = (valid + invalid) / 2;
      if (gap(mid) == null) invalid = mid; else valid = mid;
    }
    return valid;
  };
  if (gLo == null) { lo = edge(lo); gLo = gap(lo); }
  if (gHi == null) { hi = edge(hi); gHi = gap(hi); }
  if (gLo == null || gHi == null || Math.sign(gLo) === Math.sign(gHi)) {
    return { driver, base, breakEven: null, reason: "beyond-range" };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const gMid = gap(mid);
    if (gMid == null) break;
    if (Math.sign(gMid) === Math.sign(gLo)) { lo = mid; gLo = gMid; } else { hi = mid; }
  }
  return { driver, base, breakEven: base + (lo + hi) / 2, reason: null };
}

export function solveBreakEvens(cc: CommandCenterLike): BreakEvenResult[] {
  return (["sales_growth", "core_sales_pm", "ke", "g"] as const).map((driver) => solveBreakEven(cc, driver));
}
