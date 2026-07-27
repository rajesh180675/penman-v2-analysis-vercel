import { describe, expect, it } from "vitest";
import {
  MIN_BOTTOM_UP_PEERS,
  releverBeta,
  resolveBeta,
  resolveCapitalCostAssumptions,
  resolveEquityRiskPremium,
  resolveRiskFreeRate,
  resolveTerminalGrowthCeiling,
  unleverBeta,
  type PeerLeveredBeta,
} from "../capitalCostAssumptions";
import {
  resolveMacroPack,
  type EquityBetaObservation,
  type EquityBetaPack,
  type EquityBetaStatus,
  type MacroPack,
} from "../../marketPacks";
import { DEFAULT_CONFIG, type EngineConfig } from "../../types";

const ANALYSIS_AS_OF = "2026-07-26";

function macroPack(overrides: Partial<MacroPack> = {}): MacroPack {
  return {
    asOf: "2026-07-20",
    riskFreeRate: { value: 0.0685, asOf: "2026-07-20", source: "RBI 10Y G-Sec close" },
    equityRiskPremium: { value: 0.058, asOf: "2026-03-31", source: "Damodaran India implied ERP" },
    longRunNominalGrowth: { value: 0.105, asOf: "2025-12-31", source: "IMF WEO India nominal GDP trend" },
    ...overrides,
  };
}

/** Five peers at identical leverage, so the median asset beta is analytic. */
function peerBetas(leveredBetas: readonly number[], debtToEquity = 0.5, taxRate = 0.25): PeerLeveredBeta[] {
  return leveredBetas.map((leveredBeta, index) => ({
    companyId: `peer-${index}`,
    leveredBeta,
    debtToEquity,
    taxRate,
  }));
}

/**
 * A regression that already passed the pack's precision and staleness gates.
 * Built by hand rather than by calling `resolveEquityBeta`, so these cases test
 * what `resolveBeta` does with a verdict rather than re-testing how the verdict
 * is reached — that is `equityBetaPack.spec.ts`'s job.
 */
function usableRegression(overrides: { beta: number }): EquityBetaStatus {
  return {
    status: "usable",
    ticker: "TESTCO",
    beta: overrides.beta,
    standardError: 0.089,
    rSquared: 0.28,
    observations: 260,
    asOf: "2026-07-19",
    source: "Yahoo Finance adjusted-close history",
    method: "OLS on 260 weekly returns vs NIFTY 50 (^NSEI), 2021-08-01 to 2026-07-19; se 0.089, r-squared 0.280",
  };
}

/** A pinned pack with one constituent, for the aggregate-resolver cases. */
function betaPack(overrides: Partial<EquityBetaObservation> = {}): EquityBetaPack {
  return {
    asOf: "2026-07-19",
    benchmark: "NIFTY 50 (^NSEI)",
    frequency: "weekly",
    source: "Yahoo Finance adjusted-close history",
    constituents: [{
      ticker: "TESTCO",
      leveredBeta: 0.8909,
      standardError: 0.0895,
      rSquared: 0.2771,
      observations: 260,
      windowStart: "2021-08-01",
      windowEnd: "2026-07-19",
      ...overrides,
    }],
  };
}

describe("Hamada unlever/relever", () => {
  it("unlevers with the peer's own leverage and tax rate", () => {
    // 1.2 / (1 + 0.75 × 0.5) = 1.2 / 1.375
    expect(unleverBeta(1.2, 0.5, 0.25)).toBeCloseTo(0.872727, 5);
  });

  it("round-trips through relever at the same leverage", () => {
    const asset = unleverBeta(1.2, 0.5, 0.25)!;
    expect(releverBeta(asset, 0.5, 0.25)).toBeCloseTo(1.2, 10);
  });

  it("returns null rather than a number for impossible inputs", () => {
    expect(unleverBeta(1.2, -0.5, 0.25)).toBeNull();
    expect(unleverBeta(1.2, 0.5, 1)).toBeNull();
    expect(unleverBeta(Number.NaN, 0.5, 0.25)).toBeNull();
    expect(releverBeta(0.9, 0.5, 1.2)).toBeNull();
  });
});

describe("resolveBeta", () => {
  it("estimates bottom-up from enough peer betas", () => {
    // Asset betas median = 1.2/1.375; relevered at the same D/E recovers 1.2.
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
    });

    expect(result.tier).toBe("estimated");
    expect(result.value).toBeCloseTo(1.2, 6);
    expect(result.source).toContain("5 peer betas");
    expect(result.fallbackReason).toBeUndefined();
  });

  it("reflects target leverage rather than peer leverage", () => {
    // Same peers, target levered twice as high: 0.872727 × (1 + 0.75) = 1.527
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 1.0,
      taxRate: 0.25,
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
    });

    expect(result.tier).toBe("estimated");
    expect(result.value).toBeCloseTo(1.527273, 5);
  });

  it("prefers a bottom-up estimate over an explicit scalar", () => {
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
      explicitBeta: 0.95,
    });

    // A value reproducible from data outranks one whose derivation we cannot see.
    expect(result.tier).toBe("estimated");
    expect(result.value).not.toBeCloseTo(0.95, 3);
  });

  it("falls back to an explicit beta as sourced when peers are too few", () => {
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
      peerBetas: peerBetas([1.1, 1.2]),
      explicitBeta: 0.95,
    });

    expect(result.tier).toBe("sourced");
    expect(result.value).toBeCloseTo(0.95, 6);
  });

  it("labels the sector default as prior and says why", () => {
    // The current production path: no peer betas exist, so beta is a constant.
    const result = resolveBeta({ companyType: "nbfc", targetDebtToEquity: 0.5, taxRate: 0.25 });

    expect(result.tier).toBe("prior");
    expect(result.value).toBeCloseTo(1.30, 6);
    expect(result.source).toContain("nbfc");
    expect(result.fallbackReason).toContain(`needs ${MIN_BOTTOM_UP_PEERS}`);
  });

  it("falls back to prior when leverage is unknown even with enough peers", () => {
    const result = resolveBeta({
      companyType: "consumer",
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
      taxRate: 0.25,
    });

    expect(result.tier).toBe("prior");
    expect(result.fallbackReason).toContain("leverage");
  });

  it("uses the sector-neutral prior when the company type is unknown", () => {
    expect(resolveBeta({}).value).toBeCloseTo(1.0, 6);
  });

  it("ignores peer entries that cannot be unlevered", () => {
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
      peerBetas: [
        ...peerBetas([1.0, 1.1, 1.2, 1.3]),
        { companyId: "broken", leveredBeta: 1.2, debtToEquity: -1, taxRate: 0.25 },
      ],
    });

    // Four usable peers is below the floor, so this must not silently pass.
    expect(result.tier).toBe("prior");
  });
});

describe("resolveBeta — own-company regressed beta", () => {
  it("uses a usable regression as estimated, carrying its date and diagnostics", () => {
    // The gap this branch closes: on 33 loaded companies the bottom-up floor is
    // almost never met, so beta was a sector constant for effectively every run.
    const result = resolveBeta({
      companyType: "nbfc",
      regressedBeta: usableRegression({ beta: 1.3043 }),
    });

    expect(result.tier).toBe("estimated");
    expect(result.value).toBeCloseTo(1.3043, 6);
    // Dated, unlike both the sector prior and an explicit scalar.
    expect(result.asOf).toBe("2026-07-19");
    expect(result.method).toContain("260 weekly returns");
    expect(result.fallbackReason).toBeUndefined();
    // Not the nbfc prior of 1.30 by coincidence of value — check the tier moved.
    expect(result.source).not.toContain("Sector beta prior");
  });

  it("prefers a bottom-up peer median over a single-name regression", () => {
    // Both are `estimated`; the median across peers averages away part of the
    // estimation error a single regression carries, which is the standard
    // argument for industry betas.
    const result = resolveBeta({
      companyType: "consumer",
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
      regressedBeta: usableRegression({ beta: 0.6 }),
    });

    expect(result.tier).toBe("estimated");
    expect(result.value).toBeCloseTo(1.2, 6);
    expect(result.source).toContain("5 peer betas");
  });

  it("prefers a regression over an explicit scalar", () => {
    // A dated regression with published error bars is more defensible than an
    // undated number, so it outranks it — the same ordering bottom-up already had.
    const result = resolveBeta({
      companyType: "consumer",
      regressedBeta: usableRegression({ beta: 0.89 }),
      explicitBeta: 1.15,
    });

    expect(result.tier).toBe("estimated");
    expect(result.value).toBeCloseTo(0.89, 6);
  });

  it("falls back to the prior and reports WHY the regression was rejected", () => {
    // The imprecise-estimate case: IDEA regresses to 1.43 with se 0.25. The
    // reason has to be the regression's, not the peer count, because only the
    // former tells a reviewer something actionable.
    const result = resolveBeta({
      companyType: "telecom",
      regressedBeta: {
        status: "unusable",
        ticker: "IDEA",
        reason: "IDEA beta of 1.430 has standard error 0.250 (r-squared 0.112), above the 0.15 limit; the estimate is too imprecise to outrank a stated prior.",
      },
    });

    expect(result.tier).toBe("prior");
    expect(result.fallbackReason).toContain("standard error 0.250");
    expect(result.fallbackReason).not.toContain("peer beta(s)");
  });

  it("still reports the peer-count reason when no pack was consulted at all", () => {
    // Non-regression: a caller that never opted into a beta pack must keep
    // seeing the reason it always saw, not "no pack supplied" — which would read
    // as a new failure rather than unchanged behaviour.
    const result = resolveBeta({ companyType: "nbfc", targetDebtToEquity: 0.5, taxRate: 0.25 });

    expect(result.tier).toBe("prior");
    expect(result.fallbackReason).toContain(`needs ${MIN_BOTTOM_UP_PEERS}`);
  });

  it("prefers an explicit scalar over a rejected regression", () => {
    const result = resolveBeta({
      companyType: "consumer",
      regressedBeta: { status: "unusable", ticker: "PAYTM", reason: "too noisy" },
      explicitBeta: 1.05,
    });

    expect(result.tier).toBe("sourced");
    expect(result.value).toBeCloseTo(1.05, 6);
  });
});

describe("macro-derived assumptions", () => {
  const config: EngineConfig = { ...DEFAULT_CONFIG };

  it("marks a dated pack ERP as sourced", () => {
    const result = resolveEquityRiskPremium(resolveMacroPack(macroPack(), ANALYSIS_AS_OF), config);

    expect(result.tier).toBe("sourced");
    expect(result.value).toBeCloseTo(0.058, 6);
    expect(result.asOf).toBe("2026-03-31");
    expect(result.source).toContain("Damodaran");
  });

  it("marks the engine ERP constant as prior with the reason attached", () => {
    const result = resolveEquityRiskPremium(resolveMacroPack(null, ANALYSIS_AS_OF), config);

    expect(result.tier).toBe("prior");
    expect(result.value).toBeCloseTo(0.06, 6);
    expect(result.source).toBe("Engine configuration");
    expect(result.fallbackReason).toContain("No pinned equityRiskPremium");
  });

  it("marks a stale pack rate as prior rather than using it", () => {
    const stale = macroPack({ riskFreeRate: { value: 0.0685, asOf: "2026-01-05", source: "RBI 10Y G-Sec close" } });
    const result = resolveRiskFreeRate(resolveMacroPack(stale, ANALYSIS_AS_OF), config);

    expect(result.tier).toBe("prior");
    // The reason states the age and the limit, so a reviewer can judge the call.
    expect(result.fallbackReason).toContain("days old");
    expect(result.fallbackReason).toContain("limit is 30 days");
  });

  it("prefers a dated live rate over the pack, since it is the same claim only fresher", () => {
    const result = resolveRiskFreeRate(resolveMacroPack(macroPack(), ANALYSIS_AS_OF), config, {
      value: 0.0691,
      asOf: "2026-07-24",
      source: "NSE G-Sec close",
    });

    expect(result.tier).toBe("sourced");
    expect(result.value).toBeCloseTo(0.0691, 6);
    expect(result.method).toBe("Live market snapshot");
  });

  it("prefers a dated pack observation over an UNDATED live rate", () => {
    // The ordering that matters. An undated rate cannot be reproduced by a
    // reviewer, so it loses to one that can — and this is the single case where
    // supplying a pack changes a *value* rather than only a label.
    //
    // Ranking any live rate above the pack (the previous behaviour) meant a run
    // could report a sourced ERP bolted to a `prior` risk-free rate while a
    // perfectly good dated rate sat unused in the pack, which is the opposite of
    // what supplying a pack asks for.
    const result = resolveRiskFreeRate(resolveMacroPack(macroPack(), ANALYSIS_AS_OF), config, {
      value: 0.0719,
      asOf: null,
      source: "Pinned market snapshot",
    });

    expect(result.tier).toBe("sourced");
    expect(result.value).toBeCloseTo(0.0685, 6);
    expect(result.method).toBe("Pinned macro pack");
    expect(result.asOf).toBe("2026-07-20");
  });

  it("still uses an undated live rate when no pack can supply one", () => {
    // Non-regression: with no pack — which is every caller that has not opted in
    // — an undated live rate keeps being used at its own value and keeps being
    // labelled `prior`. Nothing about the reorder moves an existing discount rate.
    const result = resolveRiskFreeRate(resolveMacroPack(null, ANALYSIS_AS_OF), config, {
      value: 0.0719,
      asOf: null,
      source: "Pinned market snapshot",
    });

    expect(result.tier).toBe("prior");
    expect(result.value).toBeCloseTo(0.0719, 6);
    expect(result.fallbackReason).toContain("no as-of date");
  });

  it("falls back to an undated live rate when the pack's own rate is stale", () => {
    // A stale pack observation is unusable, so it does not shield an undated live
    // rate from being reported as the prior it is.
    const stale = macroPack({ riskFreeRate: { value: 0.0685, asOf: "2026-01-05", source: "RBI 10Y G-Sec close" } });
    const result = resolveRiskFreeRate(resolveMacroPack(stale, ANALYSIS_AS_OF), config, {
      value: 0.0719,
      asOf: null,
      source: "Pinned market snapshot",
    });

    expect(result.tier).toBe("prior");
    expect(result.value).toBeCloseTo(0.0719, 6);
  });

  it("ignores a non-positive live rate rather than discounting at zero", () => {
    const result = resolveRiskFreeRate(resolveMacroPack(macroPack(), ANALYSIS_AS_OF), config, {
      value: 0,
      asOf: "2026-07-24",
      source: "Broken feed",
    });

    expect(result.value).toBeCloseTo(0.0685, 6);
    expect(result.method).toBe("Pinned macro pack");
  });

  it("sources the terminal growth ceiling from long-run nominal growth", () => {
    const result = resolveTerminalGrowthCeiling(resolveMacroPack(macroPack(), ANALYSIS_AS_OF), config);

    expect(result.tier).toBe("sourced");
    // 10.5% nominal is above the engine's hardcoded 6% cap, which is the point:
    // the old ceiling silently truncated every terminal value.
    expect(result.value).toBeCloseTo(0.105, 6);
    expect(result.value).toBeGreaterThan(config.g_terminal_cap ?? 0.06);
  });
});

describe("resolveCapitalCostAssumptions", () => {
  it("reports the current production state as not fully defensible", () => {
    // No macro pack, no peer betas — exactly what ships today.
    const set = resolveCapitalCostAssumptions({ config: { ...DEFAULT_CONFIG }, analysisAsOf: ANALYSIS_AS_OF });

    expect(set.fullyDefensible).toBe(false);
    expect([...set.priorTierKeys].sort()).toEqual([
      "beta",
      "equity-risk-premium",
      "risk-free-rate",
      "terminal-growth-ceiling",
    ]);
  });

  it("is fully defensible only when no input rests on a sector default", () => {
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
      peerBetas: peerBetas([1.0, 1.1, 1.2, 1.3, 1.4]),
      targetDebtToEquity: 0.5,
      taxRate: 0.25,
    });

    expect(set.fullyDefensible).toBe(true);
    expect(set.priorTierKeys).toEqual([]);
    expect(set.beta.tier).toBe("estimated");
    expect(set.equityRiskPremium.tier).toBe("sourced");
  });

  it("names exactly which input is still a guess when the rest are sourced", () => {
    // A sourced ERP must not mask a prior beta — the failure this set prevents.
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      macroPack: macroPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(set.fullyDefensible).toBe(false);
    expect(set.priorTierKeys).toEqual(["beta"]);
    expect(set.riskFreeRate.tier).toBe("sourced");
    expect(set.beta.value).toBeCloseTo(0.70, 6);
  });

  it("resolves beta from a supplied beta pack, keyed on the config ticker", () => {
    // Beta pack only, deliberately no macro pack: this isolates the new branch,
    // and it is also the shape that matters for the rigor gate — beta stops
    // being a prior while the macro inputs are untouched.
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "it-services", ticker: "TESTCO" },
      betaPack: betaPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(set.beta.tier).toBe("estimated");
    expect(set.beta.value).toBeCloseTo(0.8909, 6);
    expect(set.beta.asOf).toBe("2026-07-19");
    expect([...set.priorTierKeys].sort()).toEqual([
      "equity-risk-premium",
      "risk-free-rate",
      "terminal-growth-ceiling",
    ]);
  });

  it("leaves beta a prior when the supplied pack has no entry for the ticker", () => {
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "nbfc", ticker: "ABSENT" },
      betaPack: betaPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(set.beta.tier).toBe("prior");
    expect(set.beta.value).toBeCloseTo(1.30, 6);
    expect(set.beta.fallbackReason).toContain("no constituent for ABSENT");
  });

  it("leaves beta a prior when the run has no ticker to key on", () => {
    // DEFAULT_CONFIG carries no ticker, which is the manual-entry path.
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      betaPack: betaPack(),
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(set.beta.tier).toBe("prior");
    expect(set.beta.fallbackReason).toContain("No ticker on the run");
  });

  it("does not consult the pack at all when none is supplied", () => {
    // The property that keeps this change inert for existing callers: same
    // inputs, same beta, same reason as before the pack existed.
    const withoutPack = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "nbfc", ticker: "TESTCO" },
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(withoutPack.beta.tier).toBe("prior");
    expect(withoutPack.beta.value).toBeCloseTo(1.30, 6);
    expect(withoutPack.beta.fallbackReason).toContain(`needs ${MIN_BOTTOM_UP_PEERS}`);
    expect(withoutPack.beta.fallbackReason).not.toContain("pack");
  });

  it("rejects a pack estimate dated after the analysis as look-ahead", () => {
    // The analysisAsOf must reach the beta pack too, not only the macro pack —
    // otherwise a regression window that has not happened yet would be used.
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "consumer", ticker: "TESTCO" },
      betaPack: betaPack({ windowEnd: "2026-08-16" }),
      analysisAsOf: ANALYSIS_AS_OF,
    });

    expect(set.beta.tier).toBe("prior");
    expect(set.beta.fallbackReason).toContain("look-ahead");
  });

  it("is fully defensible with a complete macro pack and a usable regressed beta", () => {
    // The end state this pack exists to make reachable without needing five
    // peers in the same sector.
    const set = resolveCapitalCostAssumptions({
      config: { ...DEFAULT_CONFIG, company_type: "it-services", ticker: "TESTCO" },
      macroPack: macroPack(),
      betaPack: betaPack(),
      analysisAsOf: ANALYSIS_AS_OF,
      // The macro pack above carries long-run nominal growth, so the ceiling is
      // sourced too and nothing is left on a default.
    });

    expect(set.terminalGrowthCeiling.tier).toBe("sourced");
    expect(set.priorTierKeys).toEqual([]);
    expect(set.fullyDefensible).toBe(true);
  });
});
