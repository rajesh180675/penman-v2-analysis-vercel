/* ================================================================
   The "Periods > kw" tile divided two different populations.

   `periodsAboveCostOfCapital` is counted over `spreadValues`
   (moatScoring/industrial.ts:85-90) — the periods that carry a finite
   SPREAD. The denominator was `totalPeriods` = `sorted.length`, every
   period analysed. For anything the pipeline produced the two differ:
   `pipeline.ts:285` computes ratios from i > 0 only, so the oldest
   period has no SPREAD, and SPREAD is null altogether when
   |avgNFO| <= 1 (ratiosResidual.ts:32-33) — i.e. for an effectively
   debt-free company, where no period is measured.

   So the gap read as periods that failed to clear kw when they were
   simply never compared to it. `spreadMeasuredPeriods` now carries the
   population both counts are drawn from.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MoatPanel from "../dashboard/MoatPanel";
import type { MoatScoreResult } from "../../engine/moatScoring";

/* Every number distinct: 7 above kw of 9 SPREAD-bearing periods over 10
   analysed. Consistent with the producer — above-kw ⊆ with-SPREAD ⊆ analysed. */
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
  return renderToStaticMarkup(<MoatPanel moat={m} />).replace(/<!-- -->/g, "");
}

/** The tile is keyed off its own label so a stray "7/10" elsewhere can't pass. */
function tile(html: string) {
  return html.slice(html.indexOf("Periods &gt; kw"));
}

describe("MoatPanel periods-above-kw tile", () => {
  it("divides by the periods that carry a SPREAD, not by every period analysed", () => {
    const html = render(moat());
    expect(tile(html)).toContain("7/9");
    // 7/10 is the defect: it reads as three years below cost of capital when
    // the tenth year had no SPREAD to compare against it.
    expect(html).not.toContain("7/10");
  });

  it("names the population each number is drawn from", () => {
    // Without the subline the tile is a bare ratio under a label that says
    // nothing about measurability, and the 10 analysed periods vanish.
    expect(render(moat())).toContain("with SPREAD · 10 analysed");
  });

  it("says no SPREAD was measurable rather than rendering 0/0", () => {
    // A debt-free company: |avgNFO| <= 1 in every period, so SPREAD is null
    // throughout and 0/0 would read as a company that cleared kw never.
    const html = render(moat({ periodsAboveCostOfCapital: 0, periodsWithStrongSpread: 0, spreadMeasuredPeriods: 0 }));
    expect(html).toContain("No SPREAD in 10 periods");
    expect(html).not.toContain("0/0");
  });

  it("shows a dash, not a ratio, when the denominator is zero", () => {
    const html = render(moat({ periodsAboveCostOfCapital: 0, periodsWithStrongSpread: 0, spreadMeasuredPeriods: 0 }));
    expect(tile(html)).toContain(">—</div>");
  });

  it("still shows the ratio when every measured period cleared kw", () => {
    // Both counts equal — it must not regress to hiding the ratio just because
    // the numbers now agree.
    const html = render(moat({ periodsAboveCostOfCapital: 9, spreadMeasuredPeriods: 9 }));
    expect(tile(html)).toContain("9/9");
    expect(html).toContain("with SPREAD · 10 analysed");
  });
});
