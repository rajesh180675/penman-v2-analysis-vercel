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

  it("labels the default sector beta and config ERP as priors without changing their values", () => {
    // Regression guard on the whole point of the tier layer: these two numbers
    // were previously indistinguishable from sourced data in the evidence rows.
    const result = resolveCostOfCapitalFromConfig({ config: DEFAULT_CONFIG });
    const beta = result.evidence.find((row) => row.component === "beta");
    const erp = result.evidence.find((row) => row.component === "erp");

    expect(beta?.tier).toBe("prior");
    expect(beta?.value).toBe(1); // sector "auto" prior, unchanged
    expect(beta?.asOf).toBeNull();
    expect(beta?.fallbackReason).toMatch(/bottom-up/i);
    expect(erp?.tier).toBe("prior");
    expect(erp?.value).toBeCloseTo(0.06, 8);
    expect(result.warnings.join(" ")).toMatch(/undated priors/i);
  });

  it("marks a dated live risk-free rate as sourced and an undated one as prior", () => {
    const dated = resolveCostOfCapitalFromConfig({
      config: DEFAULT_CONFIG,
      riskFreeRate: 0.0685,
      marketAsOf: "2026-07-20",
    });
    const datedRow = dated.evidence.find((row) => row.component === "risk-free");
    expect(datedRow?.tier).toBe("sourced");
    expect(datedRow?.asOf).toBe("2026-07-20");
    expect(dated.riskFreeRate).toBeCloseTo(0.0685, 8);

    // Same value, but a rate we cannot date is a rate a reviewer cannot reproduce.
    const undated = resolveCostOfCapitalFromConfig({ config: DEFAULT_CONFIG, riskFreeRate: 0.0685 });
    const undatedRow = undated.evidence.find((row) => row.component === "risk-free");
    expect(undatedRow?.tier).toBe("prior");
    expect(undated.riskFreeRate).toBeCloseTo(0.0685, 8);
  });

  it("takes rf and ERP from a pinned macro pack and tiers them sourced", () => {
    const result = resolveCostOfCapitalFromConfig({
      config: DEFAULT_CONFIG,
      analysisAsOf: "2026-07-26",
      macroPack: {
        asOf: "2026-07-20",
        riskFreeRate: { value: 0.0685, asOf: "2026-07-20", source: "RBI 10Y G-Sec close" },
        equityRiskPremium: { value: 0.058, asOf: "2026-03-31", source: "Damodaran India implied ERP" },
        longRunNominalGrowth: { value: 0.105, asOf: "2025-12-31", source: "IMF WEO nominal GDP trend" },
      },
    });

    expect(result.riskFreeRate).toBeCloseTo(0.0685, 8);
    expect(result.equityRiskPremium).toBeCloseTo(0.058, 8);
    expect(result.evidence.find((row) => row.component === "erp")?.tier).toBe("sourced");
    expect(result.evidence.find((row) => row.component === "erp")?.source).toMatch(/Damodaran/);
    // Beta has no pack source, so the run is still partly on a prior — and says so.
    expect(result.evidence.find((row) => row.component === "beta")?.tier).toBe("prior");
    expect(result.warnings.join(" ")).toMatch(/beta/);
  });

  describe("a country-premium ERP pairs with the default-free rate", () => {
    // Damodaran: the local risk-free rate is the government yield less the
    // sovereign's default spread; his ERP's country premium prices that risk.
    const pack = {
      asOf: "2026-09-25",
      riskFreeRate: { value: 0.0711, asOf: "2026-09-24", source: "India 10Y G-Sec" },
      equityRiskPremium: { value: 0.0708, asOf: "2026-01-05", source: "Damodaran 4.23% + 2.85% CRP" },
      sovereignDefaultSpread: { value: 0.0187, asOf: "2026-01-05", source: "Damodaran Baa3 default spread" },
      longRunNominalGrowth: null,
    };
    const capm = (macroPack: typeof pack, analysisAsOf = "2026-09-25") => resolveCostOfCapitalFromConfig({
      config: { ...DEFAULT_CONFIG, beta: 1.0, cost_of_debt_mode: "credit-spread", credit_spread: 0.02 },
      analysisAsOf,
      macroPack,
    });

    it("nets the spread from the risk-free rate in ke, and only there", () => {
      const result = capm(pack);
      expect(result.ke).toBeCloseTo(0.0711 - 0.0187 + 1.0 * 0.0708, 10);
      // A rupee borrower pays the sovereign's risk: the debt cost keeps the gross yield.
      expect(result.kdPretax).toBeCloseTo(0.0711 + 0.02, 10);
      expect(result.riskFreeRate).toBeCloseTo(0.0711, 10);
      const row = result.evidence.find((r) => r.component === "sovereign-default-spread");
      expect(row).toMatchObject({ value: 0.0187, asOf: "2026-01-05", tier: "sourced" });
    });

    it("nets nothing when the ERP is the engine default, which carries no country premium", () => {
      // The ERP lapses after a year; the spread is dated the same day, but the
      // engine's ERP it would pair with prices no sovereign risk.
      const lapsed = { ...pack, sovereignDefaultSpread: { ...pack.sovereignDefaultSpread, asOf: "2026-09-01" } };
      const result = capm(lapsed, "2027-01-10");
      expect(result.evidence.find((r) => r.component === "erp")?.tier).toBe("prior");
      expect(result.evidence.some((r) => r.component === "sovereign-default-spread")).toBe(false);
    });

    it("nets nothing when the pack states no spread", () => {
      const result = capm({ ...pack, sovereignDefaultSpread: null as unknown as typeof pack.sovereignDefaultSpread });
      expect(result.ke).toBeCloseTo(0.0711 + 1.0 * 0.0708, 10);
    });
  });

  it("estimates beta bottom-up, relevered at the target's structural leverage", () => {
    // Structural weights give CSE 80 / NFO 20 → target D/E 0.25, not the peers' 0.5.
    const result = resolveCostOfCapitalFromConfig({
      config: DEFAULT_CONFIG,
      current: recast("2025-03-31", { fo: 120, financeCost: 11 }),
      previous: recast("2024-03-31", { fo: 100, financeCost: 8 }),
      peerBetas: [1.0, 1.1, 1.2, 1.3, 1.4].map((leveredBeta, index) => ({
        companyId: `peer-${index}`,
        leveredBeta,
        debtToEquity: 0.5,
        taxRate: 0.25,
      })),
    });

    const beta = result.evidence.find((row) => row.component === "beta");
    expect(beta?.tier).toBe("estimated");
    // median asset beta 1.2/1.375 = 0.872727, relevered at D/E 0.25 → ×1.1875
    expect(result.beta).toBeCloseTo(1.036364, 5);
    expect(beta?.fallbackReason).toBeUndefined();
    // rf and ERP are still priors here (no macro pack), so the warning stands —
    // but beta must have dropped out of the list it named before.
    const priorWarning = result.warnings.find((warning) => warning.includes("undated priors"));
    expect(priorWarning).toBeDefined();
    expect(priorWarning).not.toMatch(/\bbeta\b/);
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
