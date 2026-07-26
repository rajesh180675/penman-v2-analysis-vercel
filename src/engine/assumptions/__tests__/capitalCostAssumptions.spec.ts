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
import { resolveMacroPack, type MacroPack } from "../../marketPacks";
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
});
