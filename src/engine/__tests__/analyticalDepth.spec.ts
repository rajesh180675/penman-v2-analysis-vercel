/* ================================================================
   Plan 5 keystone — analyticalDepth enricher contract tests.

   Locks the roll-up (absent/partial/rich), the per-analytic present/n/a
   handling, and the two "watch" triggers (aggressive reverse-DCF expectation,
   Damodaran CAPM ke divergence from the model ke).
================================================================ */

import { describe, it, expect } from "vitest";
import { evaluateAnalyticalDepth } from "../analyticalDepth";
import type { SOTPResult } from "../sotpValuation";

type CmdSlice = Parameters<typeof evaluateAnalyticalDepth>[0];

// Minimal builders for the four analytics the enricher reads. Only the fields
// the enricher touches are populated; the rest is cast to satisfy the slice.
function reverseDcf(impliedGrowth: number | null, anchor = 0.04, spread?: number) {
  return {
    impliedOwnerEarningsGrowth: impliedGrowth,
    impliedTerminalROIC: null,
    impliedKE: null,
    normalizedGrowthAnchor: anchor,
    expectationLabel: "",
    narrativeSpace: [],
    spreadVsNormalizedGrowth: spread ?? (impliedGrowth == null ? null : impliedGrowth - anchor),
    marketExpectationLabel: "",
  };
}
function cleanSurplus(overall: "clean" | "minor-dirty" | "material-dirty", worst = 0.002) {
  return { overall, worstResidualRatio: worst, perPeriod: [], evaluatedPeriods: 3 };
}
function capm(ke: number, beta = 0.9) {
  return {
    ke,
    citation: {
      retrievalDate: "2026-01-15",
      source: "Damodaran",
      rf: { value: 0.069, asOf: "2026-01-15" },
      erp: { value: 0.05, asOf: "2026-01-15" },
      beta,
    },
  };
}
function sotp(segmentCount: number, ev = 12000): SOTPResult {
  return {
    segments: Array.from({ length: segmentCount }, () => ({})),
    operatingSum: ev,
    unallocatedNOA: 0,
    conglomerateDiscountPct: 0,
    discountedSum: ev,
    totalEnterpriseValue: ev,
    explanation: [],
  } as unknown as SOTPResult;
}

function slice(over: Partial<CmdSlice>): CmdSlice {
  return {
    reverseDcf: reverseDcf(null),
    cleanSurplus: null,
    damodaranCapm: null,
    sotp: null,
    ...over,
  } as CmdSlice;
}

describe("evaluateAnalyticalDepth", () => {
  it("status 'absent' when no analytic ran", () => {
    const d = evaluateAnalyticalDepth(slice({}));
    expect(d.status).toBe("absent");
    expect(d.presentCount).toBe(0);
    expect(d.checks).toHaveLength(4);
    expect(d.checks.every((c) => !c.present && c.status === "n/a")).toBe(true);
  });

  it("status 'rich' when all four ran and none flagged", () => {
    const d = evaluateAnalyticalDepth(
      slice({
        reverseDcf: reverseDcf(0.05, 0.04), // spread +1% < 3% watch → ok
        cleanSurplus: cleanSurplus("clean"),
        damodaranCapm: capm(0.115),
        sotp: sotp(3),
      }),
      { modelKe: 0.11 }, // |0.115-0.11|/0.11 ≈ 4.5% < 20% → ok
    );
    expect(d.status).toBe("rich");
    expect(d.presentCount).toBe(4);
    expect(d.watchCount).toBe(0);
    expect(d.checks.every((c) => c.present && c.status === "ok")).toBe(true);
  });

  it("status 'partial' when only some analytics ran", () => {
    const d = evaluateAnalyticalDepth(
      slice({ reverseDcf: reverseDcf(0.05, 0.04), cleanSurplus: cleanSurplus("clean") }),
      { modelKe: 0.11 },
    );
    expect(d.status).toBe("partial");
    expect(d.presentCount).toBe(2);
    const sotpCheck = d.checks.find((c) => c.key === "sotp");
    expect(sotpCheck?.present).toBe(false);
    expect(sotpCheck?.status).toBe("n/a");
  });

  it("flags reverse-DCF 'watch' when implied growth runs far above the anchor", () => {
    const d = evaluateAnalyticalDepth(
      slice({ reverseDcf: reverseDcf(0.09, 0.04) }), // spread +5% > 3% watch
    );
    const rd = d.checks.find((c) => c.key === "reverse-dcf");
    expect(rd?.present).toBe(true);
    expect(rd?.status).toBe("watch");
    expect(d.watchCount).toBe(1);
  });

  it("does NOT flag reverse-DCF when the implied expectation is pessimistic (below anchor)", () => {
    const d = evaluateAnalyticalDepth(slice({ reverseDcf: reverseDcf(0.0, 0.04) }));
    const rd = d.checks.find((c) => c.key === "reverse-dcf");
    expect(rd?.status).toBe("ok"); // negative spread = opportunity, not risk
  });

  it("flags clean-surplus 'watch' only on material-dirty", () => {
    const material = evaluateAnalyticalDepth(slice({ cleanSurplus: cleanSurplus("material-dirty", 0.03) }));
    expect(material.checks.find((c) => c.key === "clean-surplus")?.status).toBe("watch");
    const minor = evaluateAnalyticalDepth(slice({ cleanSurplus: cleanSurplus("minor-dirty", 0.005) }));
    expect(minor.checks.find((c) => c.key === "clean-surplus")?.status).toBe("ok");
  });

  it("flags Damodaran CAPM 'watch' when ke diverges >20% from the model ke", () => {
    const d = evaluateAnalyticalDepth(
      slice({ damodaranCapm: capm(0.16) }),
      { modelKe: 0.11 }, // |0.16-0.11|/0.11 ≈ 45% > 20%
    );
    const c = d.checks.find((c) => c.key === "damodaran-capm");
    expect(c?.present).toBe(true);
    expect(c?.status).toBe("watch");
  });

  it("CAPM is present but cannot flag when no model ke is supplied", () => {
    const d = evaluateAnalyticalDepth(slice({ damodaranCapm: capm(0.16) }));
    const c = d.checks.find((c) => c.key === "damodaran-capm");
    expect(c?.present).toBe(true);
    expect(c?.status).toBe("ok"); // no model ke → cannot compute divergence
  });
});
