/* ================================================================
   ValuationWorkbench: the business-model evidence list.

   It rendered `businessModelEvidence.slice(0, 3)` with the array's
   length nowhere on the panel. `assessBusinessModel` pushes at most
   four lines, so the cap could hide exactly one — and only on the
   company where all four warnings fired, which is the case where the
   dropped line is least safe to lose.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ValuationWorkbench from "../ValuationWorkbench";
import type { WorkspaceValuationSnapshot } from "../../lib/researchWorkspace";

const BASE: WorkspaceValuationSnapshot = {
  id: "val-1",
  runId: null,
  recordedAt: "2026-03-31T00:00:00.000Z",
  asOf: "2026-03-31",
  marketPrice: 1200,
  signalState: "interesting",
  signalLabel: "Interesting",
  confidenceState: "production-ready",
  opportunityScore: 61,
  qualityScore: 70,
  expectedCagrStress: 0.11,
  expectedCagrBase: 0.15,
  stressUpsidePct: 0.2,
  baseUpsidePct: 0.35,
  requiredMarginOfSafetyPct: 0.25,
  convictionBucket: "starter",
  sectorTemplate: "manufacturing",
  thesis: "Thesis text.",
  reverseDcfSummary: "Reverse DCF text.",
  marketSymbol: "TEST.NS",
};

/** The four warnings `assessBusinessModel` can push, in its own order. */
const ALL_FOUR = [
  "Latest margin looks above the multi-year base (22.0% vs 14.0%), so persistence is capped.",
  "Latest growth is running ahead of the multi-year base (31.0% vs 12.0%).",
  "Latest cash conversion is weak at 55%, which reduces persistence confidence.",
  "Latest operating-cost bridge coverage is soft, so margin persistence is treated conservatively.",
];

function render(evidence?: string[]) {
  return renderToStaticMarkup(
    <ValuationWorkbench
      analysisStatus={null}
      latestSignal={null}
      latestValuation={
        evidence === undefined ? BASE : { ...BASE, businessModelEvidence: evidence }
      }
    />,
  );
}

describe("ValuationWorkbench business-model evidence", () => {
  it("renders every evidence line the engine produced", () => {
    const html = render(ALL_FOUR);
    for (const line of ALL_FOUR) {
      expect(html).toContain(line);
    }
  });

  it("shows the fourth line, which the 3-cap dropped", () => {
    // Named separately from the loop above so a regression to `.slice(0, 3)`
    // fails on a test whose name says what was lost.
    expect(render(ALL_FOUR)).toContain("operating-cost bridge coverage is soft");
  });

  it("renders the single all-clear line when no warning fired", () => {
    const allClear = "Multi-year margins, reinvestment, and cash conversion appear stable enough to support slower fade assumptions.";
    expect(render([allClear])).toContain(allClear);
  });

  it("omits the section when the engine produced nothing", () => {
    expect(render([])).not.toContain("Business-model evidence");
    expect(render(undefined)).not.toContain("Business-model evidence");
  });
});
