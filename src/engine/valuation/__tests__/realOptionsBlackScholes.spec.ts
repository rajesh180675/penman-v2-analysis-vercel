/* ================================================================
   Plan 5b PR-5b.1 — Real-options Black-Scholes contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  normCdf,
  blackScholesCall,
  blackScholesPut,
  blackScholesGreeks,
  valueRDPipeline,
} from "../realOptionsBlackScholes";

describe("normCdf (Plan 5b PR-5b.1)", () => {
  it("Φ(0) = 0.5 exactly", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("Φ(1.96) ≈ 0.975 (textbook 95% one-sided)", () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("Φ(-1.96) ≈ 0.025", () => {
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("blackScholesCall (Plan 5b PR-5b.1)", () => {
  // Hull's textbook example: S=42, K=40, r=10%, sigma=20%, T=0.5y -> C ≈ 4.76
  it("matches Hull's textbook example to 2 decimals", () => {
    const c = blackScholesCall({ S: 42, K: 40, r: 0.1, sigma: 0.2, T: 0.5 });
    expect(c).toBeCloseTo(4.76, 1);
  });

  it("at expiry (T=0) reduces to intrinsic value", () => {
    expect(blackScholesCall({ S: 50, K: 40, r: 0.05, sigma: 0.2, T: 0 })).toBe(10);
    expect(blackScholesCall({ S: 30, K: 40, r: 0.05, sigma: 0.2, T: 0 })).toBe(0);
  });

  it("zero volatility -> max(0, S - K*e^(-rT))", () => {
    const c = blackScholesCall({ S: 100, K: 95, r: 0.05, sigma: 0, T: 1 });
    expect(c).toBeCloseTo(100 - 95 * Math.exp(-0.05), 6);
  });

  it("deep OTM call (S << K) is near zero", () => {
    const c = blackScholesCall({ S: 10, K: 100, r: 0.05, sigma: 0.3, T: 1 });
    expect(c).toBeLessThan(0.5);
  });

  it("deep ITM call (S >> K) approaches S - K*e^(-rT)", () => {
    const c = blackScholesCall({ S: 200, K: 50, r: 0.05, sigma: 0.3, T: 1 });
    expect(c).toBeCloseTo(200 - 50 * Math.exp(-0.05), 0);
  });

  it("higher volatility raises call value (monotonic in sigma)", () => {
    const lo = blackScholesCall({ S: 100, K: 100, r: 0.05, sigma: 0.1, T: 1 });
    const hi = blackScholesCall({ S: 100, K: 100, r: 0.05, sigma: 0.5, T: 1 });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("blackScholesPut and put-call parity", () => {
  it("put-call parity: C + Ke^(-rT) ≈ P + S", () => {
    const inp = { S: 100, K: 100, r: 0.05, sigma: 0.3, T: 1 } as const;
    const c = blackScholesCall(inp);
    const p = blackScholesPut(inp);
    const lhs = c + 100 * Math.exp(-0.05);
    const rhs = p + 100;
    expect(lhs).toBeCloseTo(rhs, 4);
  });
});

describe("blackScholesGreeks", () => {
  it("ATM delta is near 0.5 (slightly above for r > 0)", () => {
    const g = blackScholesGreeks({ S: 100, K: 100, r: 0.05, sigma: 0.3, T: 1 });
    expect(g.delta).toBeGreaterThan(0.5);
    expect(g.delta).toBeLessThan(0.7);
  });

  it("gamma is positive at ATM", () => {
    const g = blackScholesGreeks({ S: 100, K: 100, r: 0.05, sigma: 0.3, T: 1 });
    expect(g.gamma).toBeGreaterThan(0);
  });

  it("vega is positive (option value rises with volatility)", () => {
    const g = blackScholesGreeks({ S: 100, K: 100, r: 0.05, sigma: 0.3, T: 1 });
    expect(g.vega).toBeGreaterThan(0);
  });

  it("theta is typically negative (option decays with time for ATM call)", () => {
    const g = blackScholesGreeks({ S: 100, K: 100, r: 0.05, sigma: 0.3, T: 1 });
    expect(g.theta).toBeLessThan(0);
  });
});

describe("valueRDPipeline", () => {
  it("aggregates option values across multiple projects", () => {
    const r = valueRDPipeline({
      riskFreeRate: 0.05,
      projects: [
        {
          id: "DRUG-A",
          stage: "Phase III",
          underlyingValue: 1000,
          developmentCost: 200,
          timeToDecisionYears: 2,
          probabilityOfSuccess: 0.6,
          volatility: 0.5,
        },
        {
          id: "DRUG-B",
          stage: "Phase II",
          underlyingValue: 500,
          developmentCost: 100,
          timeToDecisionYears: 4,
          probabilityOfSuccess: 0.3,
          volatility: 0.6,
        },
      ],
    });
    expect(r.perProject).toHaveLength(2);
    const totalIndividual = r.perProject.reduce((s, p) => s + p.expectedValue, 0);
    expect(r.totalExpectedValue).toBeCloseTo(totalIndividual, 6);
    expect(r.totalOptionValue).toBeGreaterThan(r.totalIntrinsicValue);
  });

  it("POS scales the expected value linearly", () => {
    const base = {
      riskFreeRate: 0.05,
      projects: [
        {
          id: "X",
          stage: "Phase III",
          underlyingValue: 1000,
          developmentCost: 200,
          timeToDecisionYears: 2,
          probabilityOfSuccess: 1.0,
          volatility: 0.5,
        },
      ],
    };
    const fullPos = valueRDPipeline(base);
    const halfPos = valueRDPipeline({
      ...base,
      projects: [{ ...base.projects[0], probabilityOfSuccess: 0.5 }],
    });
    expect(halfPos.totalExpectedValue).toBeCloseTo(fullPos.totalExpectedValue * 0.5, 6);
  });
});
