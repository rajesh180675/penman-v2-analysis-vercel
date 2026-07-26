/* ================================================================
   P6 Stage 9 parity.

   The whole value of extracting assumption resolution out of the command
   center is that it produces the SAME numbers by a shorter route. If native
   `ke` drifts from monolith `ke`, the extraction has silently forked the
   valuation instead of strangling the monolith, and every downstream model
   would be discounting at a rate no reviewer can trace.

   So these tests assert equality against `buildValuationCommandCenter` on the
   real golden fixtures rather than against hand-written expected values: a
   hardcoded 0.13 would keep passing after a policy change that moved both
   sides, which is exactly the regression this file exists to catch.
================================================================ */

import { describe, expect, it } from "vitest";
import { resolveAnalysisAssumptions } from "../assumptionResolution";
import { selectUnifiedAnalysisWindow, type UnifiedAnalysisWindow } from "../window";
import { processCompanyData } from "../../pipeline";
import { buildValuationCommandCenter } from "../../valuationCommandCenter";
import { DEFAULT_CONFIG, type EngineConfig, type RawPeriodData, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import type { ContentRef } from "../../analysisRun";
import {
  vstRealCompanySample,
  netCashCompounder,
  leveragedIndustrial,
  exceptionalEventIssuer,
} from "../../goldenCompanySuite/fixtures";

function ref<TKind extends ContentRef["kind"]>(kind: TKind, seed: string): ContentRef<TKind> {
  return {
    kind,
    contentHash: `sha256:${seed.repeat(64).slice(0, 64)}`,
    mediaType: "application/json",
    byteLength: 1,
    schemaVersion: "test-v1",
  };
}

const FACT_REF = ref("fact-set", "a");
const POLICY_REF = ref("policy-bundle", "b");
const MARKET_REF = ref("market-snapshot", "c");

const FIXTURES: readonly (readonly [string, RawPeriodData[]])[] = [
  ["vstRealCompanySample", vstRealCompanySample],
  ["netCashCompounder", netCashCompounder],
  ["leveragedIndustrial", leveragedIndustrial],
  ["exceptionalEventIssuer", exceptionalEventIssuer],
];

async function setup(rawData: RawPeriodData[], config: EngineConfig = DEFAULT_CONFIG): Promise<{
  periods: RecastPeriod[];
  window: UnifiedAnalysisWindow;
  config: EngineConfig;
}> {
  const periods = processCompanyData(rawData, config);
  const window = await selectUnifiedAnalysisWindow({ periods, rawData });
  return { periods, window, config };
}

describe("Stage 9 assumption resolution — parity with the command-center monolith", () => {
  for (const [name, rawData] of FIXTURES) {
    it(`${name}: resolves the same capital cost, share basis and readiness as the monolith`, async () => {
      const { periods, window, config } = await setup(rawData);
      // Non-vacuity guard: a fixture that stopped recasting would make every
      // equality below trivially true on empty data.
      expect(periods.length).toBeGreaterThan(1);

      const monolith = buildValuationCommandCenter({ data: periods, config });
      const native = resolveAnalysisAssumptions({
        periods,
        window,
        config,
        factRef: FACT_REF,
        policyRef: POLICY_REF,
      });

      expect(native.costOfCapital).toEqual(monolith.costOfCapital);
      expect(native.shareBasis).toEqual(monolith.shareBasis);
      expect(native.valuationReadiness).toEqual(monolith.valuationReadiness);
      expect(native.riskFreeRate).toBe(monolith.riskFreeRate);
      expect(native.marketPrice).toBe(monolith.marketPrice);
      // ke is what every intrinsic model discounts at; assert it explicitly so
      // a failure names the number a reviewer cares about.
      expect(native.costOfCapital.ke).toBe(monolith.costOfCapital.ke);
      expect(native.costOfCapital.kw).toBe(monolith.costOfCapital.kw);
    });
  }

  it("measures capital cost on the readiness anchor slice, not the latest reported period", async () => {
    const { periods, window, config } = await setup(vstRealCompanySample);
    const native = resolveAnalysisAssumptions({
      periods,
      window,
      config,
      factRef: FACT_REF,
      policyRef: POLICY_REF,
    });

    // Same truncation as core.ts:76. If this drifted, the beta relever and the
    // capital weights would be measured on a period the monolith refused to
    // value off.
    const expectedLength = Math.max(2, native.valuationReadiness.anchorIndex + 1);
    expect(native.anchorPeriods).toHaveLength(expectedLength);
    expect(native.anchorPeriods.at(-1)?.period_end).toBe(periods[expectedLength - 1]?.period_end);
  });

  it("passes the market snapshot's rate and price through to the capital cost", async () => {
    const { periods, window, config } = await setup(netCashCompounder);
    const marketSnapshot = {
      symbol: "TEST",
      provider: "test",
      fetchedAt: "2026-05-01T00:00:00.000Z",
      price: 1234,
      previousClose: null,
      changePct: null,
      marketCap: null,
      enterpriseValue: null,
      sharesOutstanding: null,
      riskFreeRate: 0.0719,
      priceAsOf: "2026-05-01",
      rateAsOf: "2026-04-30",
      freshness: "live" as const,
      sourceSummary: "test",
      warnings: [],
      history: null,
    };

    const native = resolveAnalysisAssumptions({
      periods, window, config, marketSnapshot, factRef: FACT_REF, policyRef: POLICY_REF,
    });
    const monolith = buildValuationCommandCenter({ data: periods, config, marketData: marketSnapshot });

    expect(native.riskFreeRate).toBe(0.0719);
    expect(native.marketPrice).toBe(1234);
    // rateAsOf wins over fetchedAt — the rate's own observation date is the one
    // that makes a risk-free rate citable.
    expect(native.marketAsOf).toBe("2026-04-30");
    expect(native.costOfCapital).toEqual(monolith.costOfCapital);
  });
});

describe("Stage 9 assumption candidates", () => {
  it("emits ke then kw, in that order, with fact and policy evidence", async () => {
    const { periods, window, config } = await setup(netCashCompounder);
    const native = resolveAnalysisAssumptions({
      periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF,
    });

    // Order is load-bearing: it feeds assumptionSetId and therefore each run's
    // reproducibilityHash.
    expect(native.capitalCandidates.map((candidate) => candidate.assumptionId)).toEqual([
      "cost-of-equity",
      "operating-capital-cost",
    ]);
    expect(native.capitalCandidates[0]?.key).toBe("ke");
    expect(native.capitalCandidates[0]?.value).toBe(native.costOfCapital.ke);
    expect(native.capitalCandidates[0]?.evidenceRefs).toEqual([FACT_REF, POLICY_REF]);
    expect(native.capitalCandidates.every((candidate) => candidate.required)).toBe(true);
  });

  it("withholds the market-price candidate when the run has no market snapshot to cite", async () => {
    const { periods, window } = await setup(netCashCompounder);
    // A config fallback price is a number, but it is not a citable observation:
    // without a content-addressed snapshot there is nothing to point a reviewer
    // at, so the candidate must not claim market-implied evidence.
    const config: EngineConfig = { ...DEFAULT_CONFIG, market_price: INRAbsolute(999) };
    const native = resolveAnalysisAssumptions({
      periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF,
    });

    expect(native.marketPrice).toBe(999);
    expect(native.marketCandidates).toEqual([]);
  });

  it("emits the market-price candidate against the snapshot ref when one exists", async () => {
    const { periods, window } = await setup(netCashCompounder);
    const config: EngineConfig = { ...DEFAULT_CONFIG, market_price: INRAbsolute(999) };
    const native = resolveAnalysisAssumptions({
      periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF, marketRef: MARKET_REF,
    });

    expect(native.marketCandidates).toHaveLength(1);
    expect(native.marketCandidates[0]).toMatchObject({
      assumptionId: "market-price-observation",
      mode: "market-implied",
      required: false,
      evidenceRefs: [MARKET_REF],
    });
  });
});

describe("Stage 9 fail-closed", () => {
  it("blocks per-share resolution on a single recast period", async () => {
    const { window, config } = await setup(netCashCompounder);
    const periods = processCompanyData(netCashCompounder, config).slice(0, 1);
    const native = resolveAnalysisAssumptions({
      periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF,
    });

    expect(native.perShareStatus).toBe("blocked");
    expect(native.status).toBe("blocked");
    expect(native.blockers.join(" ")).toMatch(/per-share/i);
  });

  it("matches the monolith's weak-share-basis verdict rather than relaxing it", async () => {
    const { periods, window, config } = await setup(vstRealCompanySample);
    const native = resolveAnalysisAssumptions({
      periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF,
    });

    // The plan names only FAILED, but the shipped monolith treats LOW as
    // per-share blocking too (core.ts:75 weakShareBasis). The native stage must
    // not be the more permissive of the two.
    const monolithWeak = native.shareBasis.confidence === "LOW" || native.shareBasis.confidence === "FAILED";
    expect(native.perShareStatus === "blocked").toBe(monolithWeak || periods.length < 2);
  });

  it("never reports confirmed while a blocker is present", async () => {
    for (const [, rawData] of FIXTURES) {
      const { periods, window, config } = await setup(rawData);
      const native = resolveAnalysisAssumptions({
        periods, window, config, factRef: FACT_REF, policyRef: POLICY_REF,
      });
      if (native.blockers.length > 0) expect(native.status).toBe("blocked");
      if (native.status === "confirmed") expect(native.blockers).toEqual([]);
    }
  });
});
