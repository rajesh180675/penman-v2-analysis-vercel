/* ================================================================
   That the narrative paragraph does not classify a moat the scorer
   disowned, and does not classify one from no data at all.

   The width adjective ("wide and durable") IS the claim in this
   paragraph. Two ways it used to be reachable without evidence:

     1. `dataSufficient: false` still carries an ordinary-looking
        0-100 `compositeScore`, so an IT-services company scoring 82
        read as "wide and durable" with the caveat appended after.
     2. `pickWord(null, ...)` returns its third word, so a null moat
        opened with "shows a thin economic moat" — a classification
        drawn from nothing — before saying data was insufficient.

   Fixtures differ only in `dataSufficient` (cases 1-2) or in whether
   a moat exists at all, so the classification is the only thing
   under test.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NarrativeCard from "../dashboard/NarrativeCard";
import type { MoatScoreResult } from "../../engine/moatScoring";
import type { CapAllocScoreResult } from "../../engine/capitalAllocationScoring";
import type { RecastPeriod } from "../../engine/types";

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

const DATA = [
  { period_end: "2024-03-31", is: { Sales: 200000, PAT: 40000 } },
  { period_end: "2025-03-31", is: { Sales: 240000, PAT: 48000 } },
] as unknown as RecastPeriod[];

function render(moat: MoatScoreResult | null) {
  return renderToStaticMarkup(
    <NarrativeCard
      data={DATA}
      companyId="TCS"
      moat={moat}
      capAlloc={null as unknown as CapAllocScoreResult}
      distress={null}
      marginOfSafety={0.4}
      revenueGrowth={0.2}
      fcfYield={0.05}
    />,
  );
}

describe("NarrativeCard moat prose", () => {
  it("classifies the moat when the score is sound", () => {
    // Non-vacuity: without this, the negative assertions below would also pass
    // against a card that never produced a width classification at all.
    const html = render(mkMoat(true));
    expect(html).toContain("wide and durable");
    expect(html).toContain("Competitive advantage period");
  });

  it("does not classify moat width when the scorer disowned the score", () => {
    const html = render(mkMoat(false));
    expect(html).not.toContain("wide and durable");
    expect(html).toContain("not classified");
    expect(html).toContain("RNOA is structurally inflated");
  });

  it("drops the CAP estimate when the underlying RNOA is disowned", () => {
    // CAP is a fade estimate off the same RNOA the scorer said is distorted —
    // reporting it would carry the distortion into a concrete year count.
    const html = render(mkMoat(false));
    expect(html).not.toContain("Competitive advantage period");
  });

  it("still reports the medians as evidence, without a verdict", () => {
    const html = render(mkMoat(false));
    expect(html).toContain("42.0%");
    expect(html).toContain("without a width classification");
  });

  it("does not call the moat thin when there is no moat result at all", () => {
    // `pickWord(null, ...)` returned the third word — "thin".
    const html = render(null);
    expect(html).not.toContain("thin");
    expect(html).toContain("Insufficient periods");
  });
});
