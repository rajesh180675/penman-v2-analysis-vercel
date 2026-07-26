import { describe, expect, it } from "vitest";
import {
  MIN_PEER_CONSTITUENTS,
  PEER_PRICE_STALENESS_DAYS,
  resolvePeerPackEligibility,
  usablePeerConstituents,
  type PeerPack,
  type PeerPackConstituent,
} from "../peerPack";

function constituent(id: string, overrides: Partial<PeerPackConstituent> = {}): PeerPackConstituent {
  return {
    companyId: id,
    label: id.toUpperCase(),
    price: 500,
    priceAsOf: "2026-07-20",
    shares: 100,
    ...overrides,
  };
}

function pack(count: number, overrides: Partial<PeerPack> = {}): PeerPack {
  return {
    asOf: "2026-07-20",
    source: "NSE close via market-data snapshot",
    peerGroupKey: "consumer/FMCG",
    constituents: Array.from({ length: count }, (_, index) => constituent(`peer-${index}`)),
    ...overrides,
  };
}

describe("resolvePeerPackEligibility", () => {
  it("skips with a reason when no pack was supplied", () => {
    const result = resolvePeerPackEligibility(null);

    expect(result.status).toBe("skipped");
    expect(result.usableCount).toBe(0);
    if (result.status === "skipped") expect(result.reason).toContain("No pinned peer pack");
  });

  it("admits a pack that meets the breadth floor", () => {
    const result = resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS), { analysisAsOf: "2026-07-26" });

    expect(result.status).toBe("eligible");
    expect(result.usableCount).toBe(MIN_PEER_CONSTITUENTS);
    if (result.status === "eligible") {
      expect(result.asOf).toBe("2026-07-20");
      expect(result.source).toContain("NSE");
    }
  });

  it("skips a 3-name median rather than presenting it as a sector median", () => {
    // The defect this floor exists for: 33 loaded companies means a paints or
    // cement "sector median" was a sample of one to three.
    const result = resolvePeerPackEligibility(pack(3), { analysisAsOf: "2026-07-26" });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("3 usable");
      expect(result.reason).toContain("consumer/FMCG");
    }
  });

  it("counts only constituents carrying both a dated price and a share count", () => {
    const result = resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS, {
      constituents: [
        constituent("a"),
        constituent("b", { price: null }),
        constituent("c", { shares: null }),
        constituent("d", { priceAsOf: null }),
        constituent("e", { price: 0 }),
        constituent("f", { shares: -10 }),
      ],
    }));

    expect(result.status).toBe("skipped");
    expect(result.usableCount).toBe(1);
  });

  it("rejects a pack dated after the analysis as look-ahead", () => {
    const result = resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS, { asOf: "2026-08-10" }), {
      analysisAsOf: "2026-07-26",
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toContain("look-ahead");
  });

  it("rejects a stale pack past the freshness window", () => {
    const result = resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS, { asOf: "2026-01-05" }), {
      analysisAsOf: "2026-07-26",
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toContain("stale");
  });

  it("accepts a pack exactly at the staleness boundary", () => {
    const asOf = "2026-06-26";
    const analysisAsOf = "2026-07-26";
    // 30 days apart, which is the limit rather than past it.
    expect(PEER_PRICE_STALENESS_DAYS).toBe(30);

    expect(resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS, { asOf }), { analysisAsOf }).status).toBe("eligible");
  });

  it("does not apply a freshness test when the analysis has no date", () => {
    // Absent an analysis date there is nothing to compare against; breadth is
    // still enforced, so this cannot become a silent bypass.
    expect(resolvePeerPackEligibility(pack(MIN_PEER_CONSTITUENTS, { asOf: "2020-01-01" })).status).toBe("eligible");
    expect(resolvePeerPackEligibility(pack(2, { asOf: "2020-01-01" })).status).toBe("skipped");
  });

  it("honours an explicit minimum override", () => {
    expect(resolvePeerPackEligibility(pack(2), { minimumConstituents: 2 }).status).toBe("eligible");
  });
});

describe("usablePeerConstituents", () => {
  it("returns only usable constituents keyed by id", () => {
    const usable = usablePeerConstituents(pack(0, {
      constituents: [constituent("good"), constituent("no-price", { price: null })],
    }));

    expect([...usable.keys()]).toEqual(["good"]);
  });
});
