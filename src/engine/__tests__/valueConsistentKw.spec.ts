import { describe, expect, it } from "vitest";
import { computeValuation } from "../PenmanNissimEngine";
import { computeConsistentValuation, heldAtBaseKw, solveValueConsistentKw } from "../valueConsistentKw";
import type { LegacyValuationPeriodInput } from "../forecastState/legacyAdapter";
import { DEFAULT_CONFIG } from "../types";

// A cash-rich, high-P/B firm (TCS/Infosys-shaped): equity 100 on 40 of
// operating assets and 60 of net cash, a 50% RNOA, and net financial income
// booked at the forecast's own kd. Book weights put kw at
// 0.12·100/40 + 0.05·(−60/40) = 22.5%, far above ke.
const KE = 0.12;
const KD = 0.05;
const G = 0.03;
const KW_BOOK = KE * 100 / 40 + KD * (-60 / 40);

function forecast(): LegacyValuationPeriodInput[] {
  const periods: LegacyValuationPeriodInput[] = [];
  let noa = 40;
  let cse = 100;
  const nfo = -60;
  periods.push({
    period_end: "2025-03-31",
    bs: { CSE: cse, NOA: noa, NFO: nfo, MI: 0, separationScore: 1 },
    is: { CNI: 23, OI: 20 },
    cf: { DividendPaid: 0, d_t: 0 },
  });
  for (let t = 1; t <= 5; t += 1) {
    const oi = 0.5 * noa;
    const cni = oi - KD * nfo;
    const nextNoa = noa * 1.05;
    const nextCse = nextNoa - nfo;
    periods.push({
      period_end: `${2025 + t}-03-31`,
      bs: { CSE: nextCse, NOA: nextNoa, NFO: nfo, MI: 0, separationScore: 1 },
      is: { CNI: cni, OI: oi },
      cf: { DividendPaid: Math.max(0, cni - (nextCse - cse)), d_t: cni - (nextCse - cse) },
    });
    noa = nextNoa;
    cse = nextCse;
  }
  return periods;
}

const gap = (v: { V_RE_CV3: number | null; V_ReOI_CV03: number | null }) =>
  Math.abs(v.V_RE_CV3! - v.V_ReOI_CV03!) / ((Math.abs(v.V_RE_CV3!) + Math.abs(v.V_ReOI_CV03!)) / 2);

describe("value-consistent kw", () => {
  it("brings RE and ReOI together where book-weighted kw drives them apart", () => {
    const periods = forecast();
    const atBook = computeValuation(periods, KE, KW_BOOK, G, DEFAULT_CONFIG);
    const { valuation, kwConsistency } = computeConsistentValuation(periods, KE, KW_BOOK, G, DEFAULT_CONFIG, KD);

    expect(gap(atBook)).toBeGreaterThan(0.25);
    expect(kwConsistency.method).toBe("value-consistent");
    expect(kwConsistency.kwStructural).toBeCloseTo(KW_BOOK, 12);
    expect(kwConsistency.kw).toBeLessThan(KW_BOOK);
    // One kw for every year can only approximate the identity while the value
    // weights drift (NOA grows here, net cash does not): 39% → 2.3%.
    expect(gap(valuation)).toBeLessThan(0.05);
    expect(gap(valuation)).toBeLessThan(gap(atBook) / 10);
  });

  it("satisfies the value-weighted identity at the kw it settles on", () => {
    const periods = forecast();
    const { valuation, kwConsistency } = computeConsistentValuation(periods, KE, KW_BOOK, G, DEFAULT_CONFIG, KD);
    const equity = valuation.V_ReOI_CV03!;
    expect(kwConsistency.kw).toBeCloseTo((KE * equity + KD * -60) / (equity - 60), 6);
  });

  it("keeps the structural kw, and says why, when the forecast has no borrowing cost", () => {
    const result = solveValueConsistentKw(forecast(), KE, KW_BOOK, G, DEFAULT_CONFIG, null);
    expect(result.method).toBe("structural");
    expect(result.kw).toBe(KW_BOOK);
    expect(result.reason).toMatch(/no net borrowing cost/);
  });

  it("keeps the structural kw when there is nothing to forecast", () => {
    const result = solveValueConsistentKw(forecast().slice(0, 1), KE, KW_BOOK, G, DEFAULT_CONFIG, KD);
    expect(result.method).toBe("structural");
  });

  it("values another scenario at the base case's kw, moved by its structural tilt", () => {
    const periods = forecast();
    const base = solveValueConsistentKw(periods, KE, KW_BOOK, G, DEFAULT_CONFIG, KD);
    // A scenario whose structural kw sits 1 point above the base's.
    const held = heldAtBaseKw(periods, { drivers: { ke: KE, kw: KW_BOOK + 0.01 } }, G, DEFAULT_CONFIG, base);
    expect(held.kwConsistency.kw).toBeCloseTo(base.kw + 0.01, 12);
    expect(held.kwConsistency.kwStructural).toBeCloseTo(KW_BOOK + 0.01, 12);
    expect(held.valuation.kw).toBeCloseTo(base.kw + 0.01, 12);
  });
});
