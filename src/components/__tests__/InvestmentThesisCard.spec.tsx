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

const CAP_SKIP_REASON =
  "Only 1 profitable period(s) of 10 — capital allocation score low-confidence (need ≥3)";

// Great management and a cheap price, so the moat is the only thing standing
// between this fixture and a "screaming buy". If the gate works, the verdict
// has to come down; if it silently didn't, the test would still pass on a
// weaker fixture that could never have reached a buy in the first place.
//
// `dataSufficient` is explicit rather than left off the partial cast: the
// capital-allocation gate reads it, and an absent flag is falsy, which would
// quietly withdraw the management leg and make the moat tests below pass for
// the wrong reason.
function mkCapAlloc(dataSufficient: boolean): CapAllocScoreResult {
  return {
    compositeScore: 88,
    grade: "A",
    dataSufficient,
    skipReason: dataSufficient ? null : CAP_SKIP_REASON,
  } as CapAllocScoreResult;
}

const STRONG_CAP_ALLOC = mkCapAlloc(true);

function render(moat: MoatScoreResult, capAlloc: CapAllocScoreResult | null = STRONG_CAP_ALLOC) {
  return renderToStaticMarkup(
    <InvestmentThesisCard
      moat={moat}
      capAlloc={capAlloc}
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

describe("InvestmentThesisCard and an insufficient capital-allocation grade", () => {
  // `scoreCapitalAllocation` has the same self-disqualifying shape: below three
  // periods of positive CNI it sets `dataSufficient: false` and still returns a
  // composite score and a letter grade. Here the moat is sound and the price is
  // cheap, so management is the only leg under test.
  const SOUND_MOAT = mkMoat(true);

  it("does not state a grade when the scorer marked the score unreliable", () => {
    const html = render(SOUND_MOAT, mkCapAlloc(false));
    expect(html).not.toContain("Excellent capital allocation");
    expect(html).not.toContain("grade A");
  });

  it("states why capital allocation was not assessed", () => {
    const html = render(SOUND_MOAT, mkCapAlloc(false));
    expect(html).toContain("Capital allocation not assessed");
    expect(html).toContain("profitable period(s)");
  });

  it("withdraws the screaming buy that rested on the disowned grade", () => {
    // The moat is wide and the margin of safety is 40%, so a screaming buy is
    // reachable on every other leg — it is specifically the management leg
    // being withdrawn.
    expect(render(SOUND_MOAT, mkCapAlloc(true))).toContain("Screaming Buy");
    expect(render(SOUND_MOAT, mkCapAlloc(false))).not.toContain("Screaming Buy");
  });

  it("does not read a disowned low score as an avoid either", () => {
    // The mirror-image failure, and the more damaging direction: a disowned
    // score below 35 fires the avoid branch, turning "management cannot be
    // assessed" into "management is bad".
    //
    // The moat here is deliberately middling and narrow, not the wide fixture
    // above. With a wide moat the card returns "buy" two branches earlier, so
    // the avoid branch is never evaluated and the assertion would hold whether
    // or not the gate exists.
    const middling = { ...mkMoat(true), compositeScore: 50, moatWidth: "narrow" } as MoatScoreResult;
    const weak = { ...mkCapAlloc(false), compositeScore: 12, grade: "D" } as CapAllocScoreResult;
    expect(render(middling, { ...weak, dataSufficient: true, skipReason: null })).toContain("Avoid");
    expect(render(middling, weak)).not.toContain("Avoid");
  });
});
