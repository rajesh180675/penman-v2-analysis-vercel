import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { PercentFraction } from "../../types/units";
import {
  resolveCostOfCapital,
  resolveCostOfCapitalFromConfig,
} from "../index";

function recast(period_end: string, values: { fo: number; financeCost: number; cse?: number; mi?: number; nfo?: number; noa?: number }): RecastPeriod {
  return {
    period_end,
    bs: {
      FO: values.fo,
      CSE: values.cse ?? 80,
      MI: values.mi ?? 0,
      NFO: values.nfo ?? 20,
      NOA: values.noa ?? 100,
    } as RecastPeriod["bs"],
    is: { FinanceCost: values.financeCost, taxRate: 0.25 } as RecastPeriod["is"],
    cu: {} as RecastPeriod["cu"],
    cf: {} as RecastPeriod["cf"],
  };
}

describe("cost-of-capital resolver", () => {
  it("uses CAPM and reported effective debt cost under the default explicit modes", () => {
    const previous = recast("2024-03-31", { fo: 100, financeCost: 8 });
    const current = recast("2025-03-31", { fo: 120, financeCost: 11 });
    const result = resolveCostOfCapitalFromConfig({
      config: DEFAULT_CONFIG,
      current,
      previous,
    });
    expect(result.equityMode).toBe("capm");
    expect(result.debtMode).toBe("reported-effective");
    expect(result.ke).toBeCloseTo(0.13, 8);
    expect(result.kdPretax).toBeCloseTo(0.1, 8);
    expect(result.weights.source).toBe("structural");
    expect(result.kw).toBeCloseTo(0.119, 8);
  });

  it("does not interpret a positive legacy ke scalar as manual without manual mode", () => {
    const result = resolveCostOfCapitalFromConfig({
      config: {
        ...DEFAULT_CONFIG,
        ke: PercentFraction(0.30),
        beta: 0.5,
        cost_of_equity_mode: "capm",
      },
    });
    expect(result.ke).toBeCloseTo(0.10, 8);
    expect(result.equityMode).toBe("capm");
  });

  it("requires explicit manual modes and surfaces missing rationale/evidence", () => {
    const result = resolveCostOfCapitalFromConfig({
      config: {
        ...DEFAULT_CONFIG,
        cost_of_equity_mode: "manual",
        ke: PercentFraction(0.16),
        cost_of_debt_mode: "manual",
        kd_pretax: 0.09,
      },
    });
    expect(result.ke).toBe(0.16);
    expect(result.kdPretax).toBe(0.09);
    expect(result.status).toBe("guarded");
    expect(result.warnings.join(" ")).toMatch(/rationale/i);
  });

  it("supports dated credit-spread debt evidence", () => {
    const result = resolveCostOfCapital({
      config: DEFAULT_CONFIG,
      equityPolicy: {
        mode: "capm",
        riskFreeRate: 0.07,
        beta: 1,
        equityRiskPremium: 0.06,
        riskFreeSource: "G-Sec",
        betaSource: "Regression",
        erpSource: "Policy",
        asOf: "2026-07-10",
        evidenceRefs: ["sha256:market"],
      },
      debtPolicy: {
        mode: "credit-spread",
        riskFreeRate: 0.07,
        spread: 0.025,
        curveSource: "INR curve",
        ratingSource: "AA rating",
        asOf: "2026-07-10",
        evidenceRefs: ["sha256:curve"],
      },
      current: recast("2025-03-31", { fo: 120, financeCost: 11 }),
      previous: recast("2024-03-31", { fo: 100, financeCost: 8 }),
    });
    expect(result.kdPretax).toBeCloseTo(0.095, 8);
    expect(result.debtMode).toBe("credit-spread");
  });
});
