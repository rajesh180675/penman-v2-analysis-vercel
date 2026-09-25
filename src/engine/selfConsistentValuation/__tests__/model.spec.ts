import { describe, expect, it } from "vitest";
import type { RecastPeriod } from "../../types";
import {
  computeSelfConsistentValuation,
  estimateSpreadPersistence,
  operatingValueAt,
  type SelfConsistentValuation,
  type ValuationAnchor,
} from "..";

/** Minimal recast period: only the fields the model reads. */
function period(periodEnd: string, v: { NOA: number; NFO: number; CSE: number; MI?: number; CoreOI: number; NFE: number }): RecastPeriod {
  return {
    period_end: periodEnd,
    bs: { NOA: v.NOA, NFO: v.NFO, CSE: v.CSE, MI: v.MI ?? 0 },
    is: { OI: v.CoreOI, NFE: v.NFE },
    cu: { CoreOI: v.CoreOI },
  } as unknown as RecastPeriod;
}

function flatHistory(years: number, v: Parameters<typeof period>[1]): RecastPeriod[] {
  return Array.from({ length: years }, (_, i) => period(`${2019 + i}-03-31`, v));
}

function ok(result: ReturnType<typeof computeSelfConsistentValuation>): SelfConsistentValuation {
  if (result.status !== "ok") throw new Error(`skipped: ${result.reason}`);
  return result;
}

describe("computeSelfConsistentValuation", () => {
  it("values a firm earning exactly its value-weighted kw at book", () => {
    // Book kw = (ke·CSE + kd·NFO)/NOA = (0.12·600 + 0.05·400)/1000 = 9.2%.
    // Core RNOA is 9.2% every year, so the spread is zero AT that kw — and at
    // V_E = book the value weights ARE the book weights: the fixed point.
    const history = flatHistory(6, { NOA: 1000, NFO: 400, CSE: 600, CoreOI: 92, NFE: 20 });
    const result = ok(computeSelfConsistentValuation({ history, ke: 0.12, g: 0.03, kdFallback: 0.06, shares: 10 }));
    expect(result.kw.intrinsic).toBeCloseTo(0.092, 6);
    expect(result.kw.kdSource).toBe("reported-nfe-over-nfo");
    expect(result.equityValue).toBeCloseTo(600, 3);
    expect(result.decomposition.franchiseValue).toBeCloseTo(0, 3);
    expect(result.perShare).toBeCloseTo(60, 3);
  });

  it("satisfies its own fixed point: kw = (ke·(V_E + MI) + kd·NFO) / V_op", () => {
    const history = flatHistory(8, { NOA: 1000, NFO: 300, CSE: 650, MI: 50, CoreOI: 180, NFE: 18 });
    const result = ok(computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06 }));
    const { equityValue, operatingValue } = result;
    const implied = (0.12 * (equityValue + 50) + result.kw.kd * 300) / operatingValue;
    expect(result.kw.intrinsic).toBeCloseTo(implied, 6);
    expect(operatingValue - 300 - 50).toBeCloseTo(equityValue, 6);
  });

  it("fixes the book-weight pathology for a cash-rich, high-P/B issuer", () => {
    // ITC-shaped: NOA 22k, net cash 47k, equity 69k, core RNOA ~150%.
    const history = flatHistory(8, { NOA: 22_400, NFO: -47_100, CSE: 69_500, CoreOI: 33_000, NFE: -1_120 });
    const result = ok(computeSelfConsistentValuation({ history, ke: 0.112, g: 0.04, kdFallback: 0.05 }));
    // Book weights load 3.1× of equity onto operating assets: kw ≈ 30%.
    expect(result.kw.book).toBeGreaterThan(0.28);
    // On value weights the cash is a much smaller part of equity value, so kw
    // sits above ke (operations are riskier than cash-plus-operations) but far
    // below the book-weighted figure — the Modigliani–Miller answer.
    expect(result.kw.intrinsic).toBeGreaterThan(0.112);
    expect(result.kw.intrinsic).toBeLessThan(result.kw.book / 1.5);
    expect(result.equityValue).toBeGreaterThan(result.decomposition.noa - result.decomposition.nfo);
  });

  it("dates the valuation at the latest balance sheet", () => {
    const history = [
      period("2020-03-31", { NOA: 500, NFO: 100, CSE: 400, CoreOI: 60, NFE: 5 }),
      period("2021-03-31", { NOA: 700, NFO: 150, CSE: 550, CoreOI: 90, NFE: 7 }),
      period("2022-03-31", { NOA: 900, NFO: 200, CSE: 700, CoreOI: 120, NFE: 10 }),
    ];
    const result = ok(computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06 }));
    expect(result.anchorPeriod).toBe("2022-03-31");
    expect(result.decomposition.noa).toBe(900);
    expect(result.forecast[0]!.periodEnd).toBe("2023-03-31");
    expect(result.forecast[0]!.noaOpening).toBe(900);
  });

  it("recovers its own persistence as the market-implied ω when priced at its own value", () => {
    const history = flatHistory(8, { NOA: 1000, NFO: 300, CSE: 700, CoreOI: 200, NFE: 15 });
    const base = ok(computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06, shares: 100 }));
    const priced = ok(computeSelfConsistentValuation({
      history, ke: 0.12, g: 0.04, kdFallback: 0.06, shares: 100, marketPrice: base.perShare!,
    }));
    // At market cap = V_E the market weights equal the value weights.
    expect(priced.kw.market!).toBeCloseTo(base.kw.intrinsic, 6);
    expect(priced.marketImpliedOmega!).toBeCloseTo(base.fade.omega, 4);
    expect(priced.marginOfSafety!).toBeCloseTo(0, 6);
  });

  it("fails closed with a reason instead of printing a number", () => {
    const negativeNoa = flatHistory(4, { NOA: -100, NFO: -600, CSE: 500, CoreOI: 10, NFE: -20 });
    const noNoa = computeSelfConsistentValuation({ history: negativeNoa, ke: 0.12, g: 0.04, kdFallback: 0.06 });
    expect(noNoa.status).toBe("skipped");
    const history = flatHistory(4, { NOA: 1000, NFO: 300, CSE: 700, CoreOI: 150, NFE: 15 });
    const gAboveKe = computeSelfConsistentValuation({ history, ke: 0.05, g: 0.05, kdFallback: 0.06 });
    expect(gAboveKe.status).toBe("skipped");
    expect(computeSelfConsistentValuation({ history: history.slice(0, 1), ke: 0.12, g: 0.04, kdFallback: 0.06 }).status).toBe("skipped");
  });
});

describe("operatingValueAt — closed forms", () => {
  const anchor: ValuationAnchor = { periodEnd: "2025-03-31", noa: 1000, nfo: 0, mi: 0, cse: 1000, rnoa0: 0.2, growth0: 0 };

  it("with ω = 0 only year 1 earns the spread", () => {
    const value = operatingValueAt(anchor, 0.1, 0, 0, 5)!;
    // spread 10% on 1000 for one year, discounted once.
    expect(value.operatingValue).toBeCloseTo(1000 + 100 / 1.1, 8);
    expect(value.pvTerminal).toBeCloseTo(0, 12);
  });

  it("matches the persistence perpetuity with no growth", () => {
    // Σ_{t≥1} s·ω^(t−1)·NOA/(1+kw)^t = s·NOA / (1 + kw − ω), for any horizon.
    const value = operatingValueAt(anchor, 0.1, 0.8, 0, 7)!;
    expect(value.operatingValue).toBeCloseTo(1000 + (0.1 * 1000) / (1 + 0.1 - 0.8), 8);
  });
});

describe("estimateSpreadPersistence", () => {
  it("uses the prior when there is too little history", () => {
    expect(estimateSpreadPersistence([0.2, 0.18])).toMatchObject({ omega: 0.7, source: "prior", raw: null });
  });

  it("shrinks a short-history estimate toward the prior", () => {
    const estimate = estimateSpreadPersistence([0.3, 0.27, 0.25, 0.23, 0.22, 0.21]);
    expect(estimate.source).toBe("company-shrunk");
    expect(estimate.raw).not.toBeNull();
    const n = estimate.observations;
    // Kendall bias correction first, then shrinkage toward the 0.7 prior.
    const corrected = Math.min(Math.max((n * estimate.raw! + 1) / (n - 3), 0), 0.98);
    expect(estimate.omega).toBeCloseTo(Math.min(Math.max((n * corrected + 5 * 0.7) / (n + 5), 0.3), 0.92), 10);
  });

});

describe("structural breaks", () => {
  it("estimates persistence after the last break when enough history follows it", () => {
    // Pre-merger RNOA ~100%, then a goodwill step drops it to ~25% and it stays.
    const pre = [1.0, 1.02, 0.98, 1.01].map((rnoa, i) => ({ year: 2014 + i, rnoa }));
    const post = [0.26, 0.25, 0.27, 0.25, 0.26, 0.25].map((rnoa, i) => ({ year: 2019 + i, rnoa }));
    let noa = 1000;
    const history: RecastPeriod[] = [period("2013-03-31", { NOA: noa, NFO: 0, CSE: noa, CoreOI: 1000, NFE: 0 })];
    for (const { year, rnoa } of [...pre, ...post]) {
      if (year === 2019) noa = 4000; // goodwill step
      history.push(period(`${year}-03-31`, { NOA: noa, NFO: 0, CSE: noa, CoreOI: rnoa * noa, NFE: 0 }));
    }
    const withBreak = ok(computeSelfConsistentValuation({
      history, ke: 0.12, g: 0.04, kdFallback: 0.06, structuralBreakPeriods: ["2019-03-31"],
    }));
    expect(withBreak.warnings.join(" ")).toMatch(/after the 2019-03-31 structural break/);
    expect(withBreak.fade.observations).toBeLessThan(post.length);
  });
});
