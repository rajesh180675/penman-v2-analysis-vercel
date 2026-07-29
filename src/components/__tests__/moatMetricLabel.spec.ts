/* ================================================================
   The three states a one-line moat slot has to distinguish.

   `dataSufficient: false` still carries an ordinary-looking 0-100
   `compositeScore`, and the two slots this feeds — the `VerdictBanner`
   metric and the collapsed `EvidenceItem` summary — have nowhere to
   put the `skipReason` beside it. So "the scorer disowned this score"
   has to be legible in the value itself, and has to read differently
   from "there is no score".
================================================================ */

import { describe, expect, it } from "vitest";
import { formatMoatBannerMetric } from "../dashboard/moatMetricLabel";
import type { MoatScoreResult } from "../../engine/moatScoring";

function mkMoat(dataSufficient: boolean): MoatScoreResult {
  return {
    compositeScore: 82,
    moatWidth: "wide",
    dimensions: [],
    cap: { years: 8, phi: 0.8, latestRNOA: 0.42, kw: 0.11, confidence: "medium", method: "ar1-fade" },
    periodsAboveCostOfCapital: 10,
    periodsWithStrongSpread: 9,
    spreadMeasuredPeriods: 10,
    totalPeriods: 10,
    medianRNOA: 0.42,
    medianSPREAD: 0.31,
    medianCorePM: 0.22,
    moatTrend: "stable",
    notes: [],
    dataSufficient,
    skipReason: dataSufficient ? null : "IT-services company — RNOA is structurally inflated.",
    positiveRNOAPeriods: 10,
  };
}

describe("formatMoatBannerMetric", () => {
  it("prints the score when the scorer stands behind it", () => {
    expect(formatMoatBannerMetric(mkMoat(true))).toBe("82/100");
  });

  it("prints n/a rather than the number the scorer disowned", () => {
    // The failure this exists to prevent: "82/100" in a banner directly above a
    // verdict that says the moat was not assessed.
    expect(formatMoatBannerMetric(mkMoat(false))).toBe("n/a");
  });

  it("distinguishes a disowned score from no score at all", () => {
    // Same slot, different states: "n/a" means a result exists but is not
    // usable; the em dash means there was never a result.
    expect(formatMoatBannerMetric(null)).toBe("—");
    expect(formatMoatBannerMetric(null)).not.toBe(formatMoatBannerMetric(mkMoat(false)));
  });

  it("treats undefined like absent", () => {
    expect(formatMoatBannerMetric(undefined)).toBe("—");
  });
});
