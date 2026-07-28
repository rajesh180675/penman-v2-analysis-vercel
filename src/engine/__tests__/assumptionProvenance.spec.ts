import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { buildAssumptionProvenance } from "../assumptionProvenance";
import { resolveCapitalCostAssumptions, type PeerLeveredBeta } from "../assumptions/capitalCostAssumptions";
import type { MacroPack } from "../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../types";

const ANALYSIS_AS_OF = "2026-07-26";

function macroPack(): MacroPack {
  return {
    asOf: "2026-07-20",
    riskFreeRate: { value: 0.0685, asOf: "2026-07-20", source: "RBI 10Y G-Sec close" },
    equityRiskPremium: { value: 0.058, asOf: "2026-03-31", source: "Damodaran India implied ERP" },
    longRunNominalGrowth: { value: 0.105, asOf: "2025-12-31", source: "IMF WEO nominal GDP trend" },
  };
}

function peerBetas(): PeerLeveredBeta[] {
  return [1.0, 1.1, 1.2, 1.3, 1.4].map((leveredBeta, index) => ({
    companyId: `peer-${index}`,
    leveredBeta,
    debtToEquity: 0.5,
    taxRate: 0.25,
  }));
}

/** All four inputs on undated defaults — exactly what a run produces today. */
function allPriors() {
  return resolveCapitalCostAssumptions({ config: { ...DEFAULT_CONFIG }, analysisAsOf: ANALYSIS_AS_OF });
}

/** Nothing on a default: pack-sourced macro plus a bottom-up beta. */
function fullyDefensible() {
  return resolveCapitalCostAssumptions({
    config: { ...DEFAULT_CONFIG, company_type: "consumer" },
    macroPack: macroPack(),
    analysisAsOf: ANALYSIS_AS_OF,
    peerBetas: peerBetas(),
    targetDebtToEquity: 0.5,
    taxRate: 0.25,
  });
}

describe("buildAssumptionProvenance", () => {
  it("reports absent — not defensible — when no tiers were supplied", () => {
    const summary = buildAssumptionProvenance(null);

    // The distinction that matters: silence about provenance must never read as
    // evidence of provenance.
    expect(summary.status).toBe("absent");
    expect(summary.status).not.toBe("defensible");
    expect(summary.checks).toEqual([]);
    expect(summary.priorTierKeys).toEqual([]);
  });

  it("reports the current production state as prior-dependent", () => {
    const summary = buildAssumptionProvenance(allPriors());

    expect(summary.status).toBe("prior-dependent");
    expect(summary.priorCount).toBe(4);
    expect(summary.defensibleCount).toBe(0);
    expect([...summary.priorTierKeys].sort()).toEqual([
      "beta",
      "equity-risk-premium",
      "risk-free-rate",
      "terminal-growth-ceiling",
    ]);
    expect(summary.summary).toMatch(/assumption, not an observation/);
  });

  it("dates a sourced input and leaves a prior dateless", () => {
    const summary = buildAssumptionProvenance(fullyDefensible());

    expect(summary.status).toBe("defensible");
    expect(summary.priorCount).toBe(0);
    const erp = summary.checks.find((check) => check.key === "equity-risk-premium");
    expect(erp?.tier).toBe("sourced");
    expect(erp?.asOf).toBe("2026-03-31");
    expect(erp?.source).toMatch(/Damodaran/);

    const beta = summary.checks.find((check) => check.key === "beta");
    expect(beta?.tier).toBe("estimated");
    // A bottom-up beta is computed from held data, so it has no observation date
    // of its own — that is correct, not a missing field.
    expect(beta?.asOf).toBeNull();
  });

  it("names the guess and why it was reached", () => {
    const beta = buildAssumptionProvenance(allPriors()).checks.find((check) => check.key === "beta");

    expect(beta?.tier).toBe("prior");
    expect(beta?.asOf).toBeNull();
    expect(beta?.detail).toMatch(/undated prior/);
    expect(beta?.detail).toMatch(/bottom-up/i);
  });

  it("reports mixed when only some inputs are sourced", () => {
    const summary = buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    }));

    expect(summary.status).toBe("mixed");
    expect(summary.priorTierKeys).toEqual(["beta"]);
    expect(summary.summary).toMatch(/3 of 4/);
  });

  it("reports a manual ke as an undated prior, not as absent", () => {
    // The bypass this closes. A manual ke reports no tiers, which landed here as
    // `absent` — and `absent` does not fire the provenance gate. So the least
    // attributable input in the system cleared a gate that a measured-but-
    // imprecise beta blocks: a reviewer could type a discount rate and reach
    // production-ready.
    const summary = buildAssumptionProvenance(undefined, { equityMode: "manual", ke: 0.155 });

    expect(summary.status).toBe("prior-dependent");
    expect(summary.status).not.toBe("absent");
    expect(summary.priorTierKeys).toEqual(["cost-of-equity"]);
    expect(summary.priorCount).toBe(1);
    expect(summary.defensibleCount).toBe(0);

    const check = summary.checks[0];
    expect(check?.tier).toBe("prior");
    // Dateless by nature, which is the whole point — `sourced` in this module
    // means a dated third-party value.
    expect(check?.asOf).toBeNull();
    expect(check?.value).toBeCloseTo(0.155, 6);
    // Names the rate so a reviewer sees which number is the judgment.
    expect(check?.detail).toMatch(/15\.50%/);
    expect(check?.detail).toMatch(/bypasses CAPM/);
  });

  it("keeps absent for the cases absent was written for", () => {
    // A hand-built capm policy and a run where no valuation happened both report
    // no tiers, and there silence really is the absence of a claim rather than an
    // unsourced one. Only manual mode asserts a rate without attributing it.
    expect(buildAssumptionProvenance(null).status).toBe("absent");
    expect(buildAssumptionProvenance(undefined, { equityMode: "capm" }).status).toBe("absent");
    // No options at all — the pre-existing call shape must not change meaning.
    expect(buildAssumptionProvenance(undefined).status).toBe("absent");
  });

  it("survives a manual ke with no resolved rate to name", () => {
    // The resolver returns the reviewer's number even when it is 0 and fails
    // closed on it, so this shape is reachable. The block must still report the
    // provenance rather than crash formatting a missing rate.
    const summary = buildAssumptionProvenance(undefined, { equityMode: "manual" });

    expect(summary.status).toBe("prior-dependent");
    expect(summary.checks[0]?.value).toBeNull();
    expect(summary.checks[0]?.detail).toMatch(/—/);
  });

  it("reports a reviewer-typed beta as a prior, not as sourced", () => {
    // The second bypass. `config.beta` used to resolve `sourced`, which switched
    // the gate off for the whole run: typing any beta bought production-ready.
    const summary = buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer", beta: 1.05 },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    }));

    const beta = summary.checks.find((check) => check.key === "beta");
    expect(beta?.tier).toBe("prior");
    expect(beta?.value).toBeCloseTo(1.05, 6);
    expect(summary.priorTierKeys).toContain("beta");
    // The reviewer's beta is still the value used — only its label changed.
    expect(beta?.detail).toMatch(/undated prior/);
  });
});

/* ── the gate ─────────────────────────────────────────────────────────────── */

function recastPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: { TA: 1000, CSE: 600, MI: 0, FA: 200, FO: 150, OA: 800, OL: 250, NOA: 600, NFO: 0 },
    is: {
      Sales: 900, TaxExpense: 30, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0, CNI: 90,
      FinanceCost: 12, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 10, OI: 100, OtherItems: 0, MII: 0, COGS: 600,
    },
    cu: { UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 120, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 60, FCF_cash: 80,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    },
    shareCountInput: {
      endPeriodShares: 60,
      endPeriodSharesSource: "Number of Equity Shares - Subscribed Fully Paid up",
      weightedAverageBasicShares: 60,
      weightedAverageBasicSource: "Weighted Average Number of Shares in Issue - Basic",
      weightedAverageDilutedShares: 60,
      weightedAverageDilutedSource: "Weighted Average Number of Shares in Issue - Diluted",
      faceValue: 10,
      shareCapital: 600,
    },
    trace: {},
  } as RecastPeriod;
}

const productionReadyStatus = {
  status: "production-ready" as const,
  label: "Production-ready",
  headline: "Analysis cleared current release checks",
  summary: "No blocking scope or valuation issues were detected for the loaded dataset.",
  reasons: [],
  tone: "emerald" as const,
  qualityTier: "Tier 1" as const,
  valuationStatus: "production-ready" as const,
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

function envelope(assumptionProvenance?: ReturnType<typeof buildAssumptionProvenance> | null) {
  // Real Capitaline labels, not synthetic ones: the concept-identity gate
  // resolves core concepts by label, so `metric_0__BalanceSheet` style keys
  // leave them unresolved and block valuation-eligible before this gate is
  // ever consulted.
  const rawData = Array.from({ length: 2 }, (_, i) => ({
    company_id: "RIGORCO",
    period_end: `202${4 + i}-03-31`,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000 + i,
      "Total Equity__BalanceSheet": 600 + i,
      "Property, Plant and Equipment__BalanceSheet": 320 + i,
      "Revenue From Operations(Net)__ProfitLoss": 900 + i,
      "Profit Before Tax__ProfitLoss": 120 + i,
      "Tax Expenses__ProfitLoss": 30,
      "Profit After Tax__ProfitLoss": 90 + i,
      "Net Cash From Operating Activities__CashFlow": 110 + i,
      "Purchase of Fixed Assets__CashFlow": 45,
    },
  }));
  return buildAnalysisTraceability({
    sourceMode: "manual",
    periodCount: rawData.length,
    rawMetricKeyCount: 20,
    rawData,
    recastData: rawData.map((period) => recastPeriod(period.period_end)),
    analysisStatus: productionReadyStatus,
    ...(assumptionProvenance !== undefined ? { assumptionProvenance } : {}),
  });
}

describe("assumption-provenance rigor gate", () => {
  it("the baseline fixture reaches production-ready", () => {
    // Guards every assertion below from passing vacuously: if this fixture ever
    // stops clearing the ladder, the demotion tests prove nothing.
    const env = envelope();

    expect(env.rigor.achievedLevels).toContain("production-ready");
    expect(env.assumptionProvenance).toBeNull();
  });

  it("denies production-ready when the cost of equity rests entirely on priors", () => {
    const env = envelope(buildAssumptionProvenance(allPriors()));

    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.achieved).toBe(false);
    expect(checkpoint?.detail).toMatch(/undated priors/);
    expect(checkpoint?.detail).toMatch(/beta/);
  });

  it("leaves valuation-eligible intact — a prior-based run is research, not garbage", () => {
    // The core design claim. Gating the valuation rung would fail the run closed
    // in legacyExecutor and delete a working reformulation; capping it at
    // valuation-eligible keeps the analysis and withholds only the release claim.
    const env = envelope(buildAssumptionProvenance(allPriors()));

    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.currentLevel).toBe("valuation-eligible");
    expect(env.rigor.pendingLevels).toEqual(["production-ready"]);
  });

  it("allows production-ready when every input is estimated or sourced", () => {
    const env = envelope(buildAssumptionProvenance(fullyDefensible()));

    expect(env.rigor.achievedLevels).toContain("production-ready");
    expect(env.assumptionProvenance?.status).toBe("defensible");
  });

  it("fires when a sourced ERP carries a sector beta", () => {
    // THRESHOLD CHANGE, and a deliberate reversal. This case used to be allowed
    // through, on the rationale that the gate asked whether the risk-premium term
    // was *entirely* unsourced, and that a sector beta against a dated ERP was a
    // weaker claim rather than a fabricated one.
    //
    // What changed is what a `prior` beta means. That rationale was written when
    // beta had no path to anything else: `MIN_BOTTOM_UP_PEERS` is 5 and no loaded
    // company has a peer set that deep, so `prior` was the only tier beta could
    // ever report, and a gate that fired on it would have been permanently
    // unclearable. With the regressed beta pack, `prior` now means the opposite of
    // absent — the company WAS regressed against NIFTY 50 and the slope came back
    // too imprecise to use (IDEA: 1.43, se 0.25, r-squared 0.11). That is an
    // active negative finding about this company, and a run cannot claim
    // readiness for final reporting while one term of its discount rate is a
    // sector average standing in for a rejected measurement.
    const env = envelope(buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    })));

    expect(env.assumptionProvenance?.status).toBe("mixed");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.detail).toMatch(/beta/);
    // Names only the offending term. The ERP is sourced here, so listing it as a
    // reason the cost of equity is a guess would be false.
    expect(checkpoint?.detail).not.toMatch(/equity-risk-premium/);
  });

  it("still leaves valuation-eligible intact when only beta is a prior", () => {
    // The tightening withholds the release claim; it must not delete the
    // analysis. Same principle as the all-priors case, asserted separately
    // because this is the path the shipped packs actually produce for the two
    // companies whose betas are too noisy to use.
    const env = envelope(buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    })));

    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.currentLevel).toBe("valuation-eligible");
  });

  it("fires on any single ke term, including the risk-free rate", () => {
    // ke = rf + beta x ERP has three terms and the gate covers all three. An
    // undated rf is the same defect as an undated beta: the headline discount
    // rate contains a number nobody observed.
    for (const drop of ["riskFreeRate", "equityRiskPremium"] as const) {
      const env = envelope(buildAssumptionProvenance(resolveCapitalCostAssumptions({
        config: { ...DEFAULT_CONFIG, company_type: "consumer" },
        macroPack: { ...macroPack(), [drop]: null },
        analysisAsOf: ANALYSIS_AS_OF,
        peerBetas: peerBetas(),
        targetDebtToEquity: 0.5,
        taxRate: 0.25,
      })));

      expect(env.rigor.achievedLevels, drop).not.toContain("production-ready");
    }
  });

  it("does not fire on a prior terminal-growth ceiling, which is not a ke term", () => {
    // The reason the gate names its three keys instead of testing priorCount > 0.
    // `INDIA_MACRO_PACK.longRunNominalGrowth` is deliberately null — a perpetual
    // growth ceiling is a structural judgment nobody publishes as an observation
    // — so the ceiling resolves `prior` on every real run. A count-based gate
    // would block the entire fleet forever and no amount of sourcing could clear
    // it. This is the shape the shipped packs actually produce.
    const env = envelope(buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: { ...macroPack(), longRunNominalGrowth: null },
      analysisAsOf: ANALYSIS_AS_OF,
      peerBetas: peerBetas(),
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
    })));

    expect(env.assumptionProvenance?.status).toBe("mixed");
    expect(env.assumptionProvenance?.priorTierKeys).toEqual(["terminal-growth-ceiling"]);
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("does not fire when no provenance was reported", () => {
    const env = envelope(buildAssumptionProvenance(null));

    expect(env.assumptionProvenance?.status).toBe("absent");
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("denies production-ready for a reviewer-typed manual ke", () => {
    // The gate's whole subject is whether the discount rate was observed. A
    // manual ke is the case where it demonstrably was not — and it used to be
    // the one case that sailed through, because reporting no tiers read as
    // `absent` rather than as an unsourced claim.
    const env = envelope(buildAssumptionProvenance(undefined, { equityMode: "manual", ke: 0.155 }));

    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.achieved).toBe(false);
    expect(checkpoint?.detail).toMatch(/cost-of-equity/);
    // The detail must not claim rf, beta or the ERP are the problem: manual mode
    // resolved none of them, so naming them would be false.
    expect(checkpoint?.detail).not.toMatch(/risk-free-rate/);
    expect(checkpoint?.detail).not.toMatch(/equity-risk-premium/);
  });

  it("leaves a manual-ke run valuation-eligible", () => {
    // Same principle as every other case here: withhold the release claim, keep
    // the analysis. A reviewer-supplied discount rate is a legitimate research
    // choice — it just is not an observation.
    const env = envelope(buildAssumptionProvenance(undefined, { equityMode: "manual", ke: 0.155 }));

    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.currentLevel).toBe("valuation-eligible");
  });

  it("denies production-ready when beta was typed into config", () => {
    // Reachable from the UI: ConfigSection writes `config.beta`. This used to
    // resolve `sourced` and switch the gate off for the entire run, so a typed
    // beta was worth more to the ladder than a regressed one.
    const env = envelope(buildAssumptionProvenance(resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer", beta: 1.05 },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    })));

    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    const checkpoint = env.rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.detail).toMatch(/beta/);
  });
});
