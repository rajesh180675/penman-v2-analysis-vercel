import { describe, expect, it } from "vitest";
import type { AnalysisRunV1 } from "../../../engine/analysisRun";
import type { LiveMarketDataSnapshot } from "../../../engine/marketData";
import { analysisRunCoordinatorInternals } from "../useAnalysisRunExecution";

const { fingerprintMarketSnapshot, relationForExecution } = analysisRunCoordinatorInternals;

function snapshot(overrides: Partial<LiveMarketDataSnapshot> = {}): LiveMarketDataSnapshot {
  return {
    symbol: "ASIANPAINT",
    provider: "NSE India",
    fetchedAt: "2026-07-27T09:15:04.000Z",
    price: 2_910.5,
    previousClose: 2_898.1,
    changePct: 0.0043,
    marketCap: 279_000,
    enterpriseValue: null,
    sharesOutstanding: 95.92,
    riskFreeRate: 0.07,
    priceAsOf: "2026-07-27T09:15:04.000Z",
    rateAsOf: "2026-07-27T09:15:04.000Z",
    freshness: "live",
    sourceSummary: "NSE India live quote for ASIANPAINT.",
    warnings: [],
    history: null,
    ...overrides,
  };
}

describe("fingerprintMarketSnapshot", () => {
  it("is stable across a poll that only restamps the fetch time", () => {
    // The exact defect this guards: useLiveMarketData re-fetches at least every
    // 30s, and the market-data route stamps a fresh `fetchedAt` — plus
    // `priceAsOf`/`rateAsOf`, which it pins to `fetchedAt` when the vendor gives
    // no date of its own. Fingerprinting the raw object made an idle page mint a
    // new run, and with it a new reproducibility hash, twice a minute.
    const first = snapshot();
    const second = snapshot({
      fetchedAt: "2026-07-27T09:15:34.000Z",
      priceAsOf: "2026-07-27T09:15:34.000Z",
      rateAsOf: "2026-07-27T09:15:34.000Z",
    });

    expect(fingerprintMarketSnapshot(second)).toBe(fingerprintMarketSnapshot(first));
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });

  it("changes when the observation crosses into a new day", () => {
    // Not merely cosmetic: MARKET_PRICE_AFTER_AS_OF and MARKET_RATE_AFTER_AS_OF
    // compare these dates against the run's asOf at day granularity, so a
    // rollover is a real analytical change and must fork the run.
    const before = snapshot();
    const after = snapshot({
      fetchedAt: "2026-07-28T03:45:00.000Z",
      priceAsOf: "2026-07-28T03:45:00.000Z",
      rateAsOf: "2026-07-28T03:45:00.000Z",
    });

    expect(fingerprintMarketSnapshot(after)).not.toBe(fingerprintMarketSnapshot(before));
  });

  it.each([
    ["price", { price: 2_950 }],
    ["riskFreeRate", { riskFreeRate: 0.0725 }],
    ["freshness", { freshness: "stale" as const }],
    ["symbol", { symbol: "DABUR" }],
    ["sharesOutstanding", { sharesOutstanding: 96.4 }],
  ])("still changes when %s changes", (_field, overrides) => {
    expect(fingerprintMarketSnapshot(snapshot(overrides))).not.toBe(fingerprintMarketSnapshot(snapshot()));
  });

  it("distinguishes an absent snapshot from a present one", () => {
    expect(fingerprintMarketSnapshot(null)).toBe("null");
    expect(fingerprintMarketSnapshot(snapshot())).not.toBe("null");
  });

  it("tolerates a snapshot whose dates are absent", () => {
    const undated = snapshot({ price: null, priceAsOf: null, rateAsOf: null, riskFreeRate: null });
    expect(() => fingerprintMarketSnapshot(undated)).not.toThrow();
    expect(fingerprintMarketSnapshot(undated)).toBe(fingerprintMarketSnapshot(undated));
  });
});

describe("relationForExecution", () => {
  const fingerprints = { rawFingerprint: "raw-1", configFingerprint: "config-1", marketFingerprint: "market-1" };
  const previous = {
    issuerId: "ASIANPAINT",
    ...fingerprints,
    // Only runId and reproducibilityHash are read off the parent run, so the
    // cast is narrowed to this property rather than the whole record — the
    // fingerprints and issuerId above stay typechecked.
    run: { runId: "run-1", reproducibilityHash: "sha256:aaa" } as unknown as AnalysisRunV1,
  };

  it("roots the first run for an issuer", () => {
    expect(relationForExecution(null, "ASIANPAINT", fingerprints)).toEqual({
      kind: "root", parentRunId: null, parentReproducibilityHash: null,
    });
  });

  it("roots rather than forks when the issuer changes", () => {
    // A different company is not a child of the previous company's run.
    expect(relationForExecution(previous, "DABUR", fingerprints).kind).toBe("root");
  });

  it.each([
    ["source-restatement", { ...fingerprints, rawFingerprint: "raw-2" }],
    ["market-refresh", { ...fingerprints, marketFingerprint: "market-2" }],
    ["assumption-change", { ...fingerprints, configFingerprint: "config-2" }],
    ["manual-rerun", fingerprints],
  ])("attributes a same-issuer re-run to %s", (forkReason, next) => {
    expect(relationForExecution(previous, "ASIANPAINT", next)).toEqual({
      kind: "child",
      parentRunId: "run-1",
      parentReproducibilityHash: "sha256:aaa",
      forkReason,
    });
  });

  it("prefers the source restatement when several inputs changed at once", () => {
    // Precedence matters for the audit trail: restated source data subsumes an
    // assumption or market change made in the same edit.
    const relation = relationForExecution(previous, "ASIANPAINT", {
      rawFingerprint: "raw-2", configFingerprint: "config-2", marketFingerprint: "market-2",
    });
    expect(relation).toMatchObject({ forkReason: "source-restatement" });
  });
});
