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

function mkMoat(dataSufficient: boolean, overrides: Partial<MoatScoreResult> = {}): MoatScoreResult {
  return {
    compositeScore: 82,
    moatWidth: "wide",
    dimensions: [],
    cap: { years: 8, phi: 0.8, latestRNOA: 0.42, kw: 0.11, confidence: "medium", method: "ar1-fade" },
    // Three distinct counts: 7 above kw, of 9 periods carrying a SPREAD, over
    // 10 analysed. They must differ or the cost-of-capital clause below cannot
    // tell the two denominators apart.
    periodsAboveCostOfCapital: 7,
    periodsWithStrongSpread: 5,
    spreadMeasuredPeriods: 9,
    totalPeriods: 10,
    medianRNOA: 0.42,
    medianSPREAD: 0.31,
    medianCorePM: 0.22,
    moatTrend: "stable",
    notes: [],
    dataSufficient,
    skipReason: dataSufficient ? null : SKIP_REASON,
    positiveRNOAPeriods: 10,
    ...overrides,
  };
}

const DATA = [
  { period_end: "2024-03-31", is: { Sales: 200000, PAT: 40000 } },
  { period_end: "2025-03-31", is: { Sales: 240000, PAT: 48000 } },
] as unknown as RecastPeriod[];

const CAP_SKIP_REASON =
  "Only 1 profitable period(s) of 10 — capital allocation score low-confidence (need ≥3)";

function mkCapAlloc(dataSufficient: boolean): CapAllocScoreResult {
  return {
    compositeScore: 84,
    grade: "A",
    dimensions: [],
    medianPayoutRatio: 0.3,
    medianFCFConversion: 0.91,
    medianIncrementalROIC: 0.27,
    buybacksValueAccretive: 2,
    buybackPeriods: 3,
    dilutiveIssuances: 0,
    totalPeriods: 10,
    trend: "improving",
    notes: [],
    dataSufficient,
    skipReason: dataSufficient ? null : CAP_SKIP_REASON,
    profitablePeriods: dataSufficient ? 10 : 1,
  };
}

function render(moat: MoatScoreResult | null, capAlloc: CapAllocScoreResult | null = null) {
  return renderToStaticMarkup(
    <NarrativeCard
      data={DATA}
      companyId="TCS"
      moat={moat}
      capAlloc={capAlloc}
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

  it("counts years above cost of capital against the years that had a spread", () => {
    // "7 of 10 years" put two populations side by side:
    // `periodsAboveCostOfCapital` is counted over periods with a finite SPREAD
    // (moatScoring/industrial.ts:85-90) while `totalPeriods` is every period
    // analysed, so the three-year gap read as three years the company failed to
    // clear kw when they were never measured against it.
    const html = render(mkMoat(true));
    expect(html).toContain("7 of 9 years carrying a computable spread");
    expect(html).not.toContain("7 of 10");
  });

  it("says no year was measurable rather than reporting 0 of 10", () => {
    // A debt-free company: SPREAD is null in every period
    // (ratiosResidual.ts:32-33), so there is no denominator to divide by.
    const html = render(mkMoat(true, {
      periodsAboveCostOfCapital: 0,
      periodsWithStrongSpread: 0,
      spreadMeasuredPeriods: 0,
    }));
    expect(html).toContain("no year carried a computable spread");
    expect(html).not.toContain("0 of 0");
    expect(html).not.toContain("0 of 10");
  });

  it("keeps the same denominator in the disowned-score paragraph", () => {
    // The `else if (moat)` branch reports the medians as evidence without a
    // verdict — it carries the same clause and had the same mismatch.
    const html = render(mkMoat(false));
    expect(html).toContain("7 of 9 years carrying a computable spread");
    expect(html).not.toContain("7 of 10");
  });

  it("does not call the moat thin when there is no moat result at all", () => {
    // `pickWord(null, ...)` returned the third word — "thin".
    const html = render(null);
    expect(html).not.toContain("thin");
    expect(html).toContain("Insufficient periods");
  });
});

describe("NarrativeCard capital allocation prose", () => {
  // Same defect shape as the moat paragraph: `scoreCapitalAllocation` sets
  // `dataSufficient: false` below three profitable periods and still returns a
  // composite score and a letter grade. The grade is a verdict in one
  // character, so it must not survive the scorer disowning it.
  const sound = mkMoat(true);

  it("grades capital allocation when the score is sound", () => {
    // Non-vacuity for the three negative assertions below.
    const html = render(sound, mkCapAlloc(true));
    expect(html).toContain("disciplined and value-creating");
    expect(html).toContain("Grade A");
    expect(html).toContain("91%");
  });

  it("does not state a grade when the scorer disowned the score", () => {
    const html = render(sound, mkCapAlloc(false));
    expect(html).not.toContain("disciplined and value-creating");
    expect(html).not.toContain("Grade A");
    expect(html).toContain("not graded");
    expect(html).toContain("profitable period(s)");
  });

  it("drops the ratios measured against net income when it is disowned", () => {
    // FCF conversion and incremental ROIC are both ratios over CNI, which is
    // the quantity the skip reason says is negative or missing — they invert
    // sign rather than degrade.
    const html = render(sound, mkCapAlloc(false));
    expect(html).not.toContain("FCF conversion runs at");
    expect(html).not.toContain("incremental ROIC on new NOA");
  });

  it("still reports buyback and issuance counts, which do not depend on CNI", () => {
    const html = render(sound, mkCapAlloc(false));
    expect(html).toContain("value-accretive in 2 period(s)");
  });

  it("does not call capital allocation average when there is no result at all", () => {
    // `pickWord(null, ...)` returned the third word — "average".
    const html = render(sound, null);
    expect(html).not.toContain("looks average");
    expect(html).toContain("not scored");
  });
});
