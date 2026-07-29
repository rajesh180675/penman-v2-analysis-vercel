/* ================================================================
   The same mismatched denominator, on the V3 Analytics surface.

   Two slots here put a count drawn from `spreadValues` over
   `totalPeriods`: the "Moat Trend" badge and the "Strong SPREAD
   periods (>5%)" row. Both counts skip periods with no finite SPREAD
   (moatScoring/industrial.ts:85-90) while `totalPeriods` counts every
   period analysed — see MoatPanel.spec.tsx for why the two can never
   coincide.

   The strong-SPREAD row is the sharper case: a period without a SPREAD
   cannot have one above 5%, so dividing by every period understated
   durability on exactly the companies the moat framework is meant to
   identify.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MoatSection } from "../v3-analytics/MoatSection";
import type { MoatScoreResult } from "../../engine/moatScoring";

/* Four distinct numbers so no two slots can be confused: 7 above kw, 5 strong,
   of 9 SPREAD-bearing periods, over 10 analysed. */
function moat(overrides: Partial<MoatScoreResult> = {}): MoatScoreResult {
  return {
    compositeScore: 74,
    moatWidth: "wide",
    dimensions: [],
    cap: { years: 8, phi: 0.8, latestRNOA: 0.31, kw: 0.11, confidence: "medium", method: "ar1-fade" },
    periodsAboveCostOfCapital: 7,
    periodsWithStrongSpread: 5,
    spreadMeasuredPeriods: 9,
    totalPeriods: 10,
    medianRNOA: 0.31,
    medianSPREAD: 0.14,
    medianCorePM: 0.22,
    moatTrend: "stable",
    notes: [],
    dataSufficient: true,
    skipReason: null,
    positiveRNOAPeriods: 10,
    ...overrides,
  };
}

function render(m: MoatScoreResult) {
  return renderToStaticMarkup(<MoatSection moat={m} />).replace(/<!-- -->/g, "");
}

describe("MoatSection SPREAD-period denominators", () => {
  it("counts the trend badge against SPREAD-bearing periods", () => {
    const html = render(moat());
    expect(html).toContain("7/9 SPREAD periods above kw");
    expect(html).not.toContain("7/10");
  });

  it("counts strong-SPREAD periods against SPREAD-bearing periods", () => {
    const html = render(moat());
    expect(html).toContain("5 / 9 with SPREAD");
    // 5 / 10 understates durability: the unmeasured period cannot have had a
    // SPREAD above 5%, so it does not belong in the denominator.
    expect(html).not.toContain("5 / 10");
  });

  it("says no SPREAD was measurable rather than dividing by zero", () => {
    const html = render(moat({
      periodsAboveCostOfCapital: 0,
      periodsWithStrongSpread: 0,
      spreadMeasuredPeriods: 0,
    }));
    expect(html).toContain("no SPREAD in 10 periods");
    expect(html).toContain("— (no SPREAD in 10 periods)");
    expect(html).not.toContain("0/0");
    expect(html).not.toContain("0 / 0");
  });

  it("still shows the ratios when every measured period qualified", () => {
    // Non-vacuity for the negative assertions above: the ratios must survive
    // the two counts agreeing with the denominator.
    const html = render(moat({
      periodsAboveCostOfCapital: 9,
      periodsWithStrongSpread: 9,
    }));
    expect(html).toContain("9/9 SPREAD periods above kw");
    expect(html).toContain("9 / 9 with SPREAD");
  });
});
