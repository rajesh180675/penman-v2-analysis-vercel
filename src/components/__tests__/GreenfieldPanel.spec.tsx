/* ================================================================
   GreenfieldPanel: the two confidence score-adjustment lists.

   Both were `.slice(0, 3)`d with neither total on the panel, over
   arrays `scoreOne` pushes in detector-emission order — one penalty
   per active signal, one bonus per accepted transformation group,
   both unbounded. So the three shown were "whichever detectors ran
   first", displayed as signed point deductions under a confidence
   score, where the three a reader wants are the three biggest.

   Fixtures are factories, not shared consts. With a module-level
   array, an in-place-sort regression reorders the fixture during the
   first test, and every later assertion — including the one named
   "does not reorder" — then measures against the already-corrupted
   array and passes. A fresh array per test is what makes that
   assertion mean anything.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GreenfieldPanel } from "../debug/GreenfieldPanel";
import type {
  ConfidenceScore,
  GreenfieldPipelineResult,
} from "../../engine/greenfieldPipeline";

function score(overrides: Partial<ConfidenceScore>): ConfidenceScore {
  return {
    level: "medium",
    score: 60,
    penalties: [],
    bonuses: [],
    caps: [],
    ...overrides,
  };
}

function result(confidence: {
  asReported: ConfidenceScore;
  adjusted: ConfidenceScore;
}): GreenfieldPipelineResult {
  return {
    asReported: [],
    adjusted: [],
    signals: [],
    triage: {
      activeSignals: [],
      suppressedSignals: [],
      aggregateSeverity: "NONE",
      adjusterOrder: [],
      rationale: [],
      userPolicy: {
        structuralBreakWindowPolicy: "auto-post-break",
        adjustmentMode: "as-reported-only",
      },
    },
    auditTrail: [],
    validation: {
      status: "accepted",
      checks: [],
      diffTable: [],
      acceptedCount: 0,
      rejectedCount: 0,
    },
    confidence,
    analysisWindow: {
      mode: "auto-post-break",
      excludedPeriods: [],
      includedPeriods: [],
      reason: "",
      minHistorySatisfied: true,
    },
  };
}

/**
 * Five penalties in detector-emission order, which is what `scoreOne` produces.
 * The biggest deduction sits last on purpose: a head-slice keeps the three
 * smallest and drops the 25-point one.
 */
function penalties() {
  return [
    { reason: "small-a", points: 5 },
    { reason: "small-b", points: 5 },
    { reason: "small-c", points: 5 },
    { reason: "mid-one", points: 20 },
    { reason: "biggest-one", points: 25 },
  ];
}

const EMITTED_PENALTY_ORDER = ["small-a", "small-b", "small-c", "mid-one", "biggest-one"];

function bonuses() {
  return [
    { reason: "bonus-small-a", points: 10 },
    { reason: "bonus-small-b", points: 10 },
    { reason: "bonus-small-c", points: 10 },
    { reason: "bonus-biggest", points: 15 },
  ];
}

function render(confidence: {
  asReported: ConfidenceScore;
  adjusted: ConfidenceScore;
}) {
  return renderToStaticMarkup(<GreenfieldPanel greenfield={result(confidence)} />);
}

function renderPenalties(list: ReturnType<typeof penalties>) {
  return render({ asReported: score({ penalties: list }), adjusted: score({}) });
}

function renderBonuses(list: ReturnType<typeof bonuses>) {
  return render({ asReported: score({}), adjusted: score({ bonuses: list }) });
}

describe("GreenfieldPanel penalties", () => {
  it("shows the largest penalties, not the first three the detectors emitted", () => {
    const html = renderPenalties(penalties());
    expect(html).toContain("biggest-one");
    expect(html).toContain("mid-one");
    // Exactly one of the three equal 5-pointers survives as the third slot; the
    // assertion that matters is that neither big deduction was the one dropped.
    expect(html).not.toContain("small-c");
  });

  it("orders the shown penalties largest first", () => {
    const html = renderPenalties(penalties());
    expect(html.indexOf("biggest-one")).toBeLessThan(html.indexOf("mid-one"));
  });

  it("says how many penalties there are and how many it left out", () => {
    const html = renderPenalties(penalties());
    expect(html).toContain("Penalties (5)");
    expect(html).toContain("+2 smaller penalties not shown");
  });

  it("words a single hidden penalty in the singular", () => {
    const html = renderPenalties(penalties().slice(0, 4));
    expect(html).toContain("+1 smaller penalty not shown");
  });

  it("claims nothing hidden when every penalty fits", () => {
    const html = renderPenalties(penalties().slice(0, 2));
    expect(html).toContain("Penalties (2)");
    expect(html).not.toMatch(/not shown/);
  });

  it("renders no penalty header when the score took no deductions", () => {
    expect(render({ asReported: score({}), adjusted: score({}) })).not.toMatch(/Penalties \(/);
  });

  it("does not reorder the array it was given", () => {
    // Compared against a literal, not against the fixture: an in-place sort
    // would reorder both sides of a fixture-to-fixture comparison and pass.
    const list = penalties();
    renderPenalties(list);
    expect(list.map((item) => item.reason)).toEqual(EMITTED_PENALTY_ORDER);
  });
});

describe("GreenfieldPanel bonuses", () => {
  it("shows the largest bonus rather than dropping it off the end", () => {
    const html = renderBonuses(bonuses());
    expect(html).toContain("bonus-biggest");
    expect(html).not.toContain("bonus-small-c");
  });

  it("says how many bonuses there are and how many it left out", () => {
    const html = renderBonuses(bonuses());
    expect(html).toContain("Bonuses (4)");
    expect(html).toContain("+1 smaller bonus not shown");
  });

  it("words multiple hidden bonuses in the plural", () => {
    const html = renderBonuses([...bonuses(), { reason: "bonus-extra", points: 10 }]);
    expect(html).toContain("+2 smaller bonuses not shown");
  });

  it("claims nothing hidden when every bonus fits", () => {
    const html = renderBonuses(bonuses().slice(0, 3));
    expect(html).toContain("Bonuses (3)");
    expect(html).not.toMatch(/not shown/);
  });

  it("renders no bonus header when nothing was credited", () => {
    expect(render({ asReported: score({}), adjusted: score({}) })).not.toMatch(/Bonuses \(/);
  });

  it("does not reorder the array it was given", () => {
    const list = bonuses();
    renderBonuses(list);
    expect(list.map((item) => item.reason)).toEqual([
      "bonus-small-a",
      "bonus-small-b",
      "bonus-small-c",
      "bonus-biggest",
    ]);
  });
});

describe("GreenfieldPanel counts each list independently", () => {
  it("reports both totals, not a combined one", () => {
    const html = render({
      asReported: score({ penalties: penalties() }),
      adjusted: score({ bonuses: bonuses() }),
    });
    expect(html).toContain("Penalties (5)");
    expect(html).toContain("Bonuses (4)");
    expect(html).toContain("+2 smaller penalties not shown");
    expect(html).toContain("+1 smaller bonus not shown");
  });

  it("renders nothing at all without a greenfield result", () => {
    expect(renderToStaticMarkup(<GreenfieldPanel greenfield={null} />)).toBe("");
  });
});
