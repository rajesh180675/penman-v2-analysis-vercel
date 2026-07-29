/* ================================================================
   The "Buybacks Accretive" tile divided two different populations.

   `buybacksValueAccretive` only increments inside `if (buyback > 0)`
   and `spread > 0` (capitalAllocationScoring/industrial.ts:112-115).
   The denominator was `totalPeriods` = `periods.length` (:487) —
   every period analysed, buyback or not. A company that bought back
   twice and got both right read "2/15": thirteen value-destroying
   buybacks that never happened.

   The engine already tracked `totalBuybackPeriods` (:95) but emitted
   it only as an evidence string (:149), so the right denominator was
   computed and discarded. It is now returned as `buybackPeriods`.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CapitalAllocationPanel from "../dashboard/CapitalAllocationPanel";
import type { CapAllocScoreResult } from "../../engine/capitalAllocationScoring";

/* Every number distinct: 2 accretive of 3 buyback periods over 15 analysed.
   Consistent with the producer — accretive ⊆ buyback ⊆ analysed. */
function result(overrides: Partial<CapAllocScoreResult> = {}): CapAllocScoreResult {
  return {
    compositeScore: 71,
    grade: "B",
    dimensions: [],
    medianPayoutRatio: 0.31,
    medianFCFConversion: 0.87,
    medianIncrementalROIC: 0.19,
    buybacksValueAccretive: 2,
    buybackPeriods: 3,
    dilutiveIssuances: 0,
    totalPeriods: 15,
    trend: "stable",
    notes: [],
    dataSufficient: true,
    skipReason: null,
    profitablePeriods: 15,
    ...overrides,
  };
}

function render(r: CapAllocScoreResult) {
  return renderToStaticMarkup(<CapitalAllocationPanel result={r} />).replace(/<!-- -->/g, "");
}

describe("CapitalAllocationPanel buyback accretion tile", () => {
  it("divides accretive buybacks by buyback periods, not by every period", () => {
    const html = render(result());
    expect(html).toContain("2/3");
    // 2/15 is the defect: it reads as 13 non-accretive buybacks.
    expect(html).not.toContain("2/15");
  });

  it("names the population each number is drawn from", () => {
    const html = render(result());
    // Without this the tile shows a bare "2/3" under a label that says nothing
    // about buyback periods, and the 15 analysed periods vanish from the tile.
    expect(html).toContain("buyback periods · 15 analysed");
  });

  it("says there were no buybacks rather than rendering 0/0", () => {
    const html = render(result({ buybacksValueAccretive: 0, buybackPeriods: 0 }));
    expect(html).toContain("No buybacks in 15 periods");
    expect(html).not.toContain("0/0");
  });

  it("shows a dash, not a ratio, when the denominator is zero", () => {
    const html = render(result({ buybacksValueAccretive: 0, buybackPeriods: 0 }));
    const tile = html.slice(html.indexOf("Buybacks Accretive"));
    expect(tile).toContain(">—</div>");
  });

  it("still reports every buyback as accretive when every buyback was", () => {
    // The case where both denominators coincide — it must not regress to
    // hiding the ratio just because the two numbers now agree.
    const html = render(result({ buybacksValueAccretive: 4, buybackPeriods: 4, totalPeriods: 4 }));
    expect(html).toContain("4/4");
    expect(html).toContain("buyback periods · 4 analysed");
  });
});
