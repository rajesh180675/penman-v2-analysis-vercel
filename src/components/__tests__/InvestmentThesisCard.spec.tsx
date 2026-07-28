/* ================================================================
   That a moat score the scorer disowned cannot become a verdict.

   `computeMoatScore` returns a `compositeScore` and a `moatWidth` even
   when it has just said not to trust them — `dataSufficient: false` with
   a `skipReason`, for a loss-maker or for an IT-services company whose
   RNOA is inflated by a NOA denominator near zero. The number it returns
   in that case is an ordinary-looking 0-100, which is exactly why every
   consumer that read `compositeScore` directly turned it into a verdict.

   These render the card with one fixture at score 82 / width `wide`,
   flipping only `dataSufficient`. Same number, same width: the only
   thing under test is whether the card respects the disclaimer.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvestmentThesisCard from "../dashboard/InvestmentThesisCard";
import type { MoatScoreResult } from "../../engine/moatScoring";
import type { CapAllocScoreResult } from "../../engine/capitalAllocationScoring";

const SKIP_REASON =
  "IT-services company — RNOA is structurally inflated (tiny NOA denominator). "
  + "Moat width classification unreliable.";

function mkMoat(dataSufficient: boolean): MoatScoreResult {
  return {
    compositeScore: 82,
    moatWidth: "wide",
    dimensions: [],
    cap: { years: 8, phi: 0.8, latestRNOA: 0.42, kw: 0.11, confidence: "medium", method: "ar1-fade" },
    periodsAboveCostOfCapital: 10,
    periodsWithStrongSpread: 9,
    totalPeriods: 10,
    medianRNOA: 0.42,
    medianSPREAD: 0.31,
    medianCorePM: 0.22,
    moatTrend: "stable",
    notes: [],
    dataSufficient,
    skipReason: dataSufficient ? null : SKIP_REASON,
    positiveRNOAPeriods: 10,
  };
}

// Great management and a cheap price, so the moat is the only thing standing
// between this fixture and a "screaming buy". If the gate works, the verdict
// has to come down; if it silently didn't, the test would still pass on a
// weaker fixture that could never have reached a buy in the first place.
const STRONG_CAP_ALLOC = { compositeScore: 88, grade: "A" } as CapAllocScoreResult;

function render(moat: MoatScoreResult) {
  return renderToStaticMarkup(
    <InvestmentThesisCard
      moat={moat}
      capAlloc={STRONG_CAP_ALLOC}
      distress={null}
      marginOfSafety={0.4}
      price={100}
      intrinsic={140}
    />,
  );
}

describe("InvestmentThesisCard and an insufficient moat", () => {
  it("reaches a screaming buy when the moat score is sound", () => {
    // Non-vacuity. Without this, the assertions below would also pass if the
    // card were broken in some way that never produced a buy at all.
    const html = render(mkMoat(true));
    expect(html).toContain("Screaming Buy");
    expect(html).toContain("Strong moat (score 82, wide)");
  });

  it("does not claim a strong moat when the scorer marked the score unreliable", () => {
    const html = render(mkMoat(false));
    expect(html).not.toContain("Strong moat");
    expect(html).not.toContain("score 82");
  });

  it("states why the moat was not assessed instead of going silent", () => {
    // A verdict with an unexplained gap in its evidence is harder to review
    // than one that names the gap.
    const html = render(mkMoat(false));
    expect(html).toContain("Moat not assessed");
    expect(html).toContain("RNOA is structurally inflated");
  });

  it("downgrades the verdict rather than crediting an unusable score", () => {
    // The fixture keeps great capital allocation and a 40% margin of safety, so
    // this is specifically the moat leg being withdrawn: "screaming buy"
    // requires a great business, and there is no longer evidence of one.
    const html = render(mkMoat(false));
    expect(html).not.toContain("Screaming Buy");
  });
});
