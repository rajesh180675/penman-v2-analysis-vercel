/* ================================================================
   The three states the dashboard's earnings-quality tile has to
   distinguish, and the one number it must never show.

   The tile used to render `parserFidelity.score / 100`. That is a
   syntactic measure — how much of the source file was mapped — and
   `QualitySignalPanel`, in the same grid block, already renders it
   under its own name. So the value had to change; these tests pin
   what it changed to, and that a placeholder composite is not
   allowed to reach the tile as a score.
================================================================ */

import { describe, expect, it } from "vitest";
import { earningsQualityMetric } from "../dashboard/earningsQualityMetric";
import { buildEarningsQualitySummary } from "../../engine/earningsQualitySummary";
import type { EarningsQualityCard } from "../../engine/earningsQuality";
import type { EarningsQualityCheck } from "../../engine/types/earningsQualitySummary";

const DIMENSIONS: EarningsQualityCheck[] = [
  { key: "timeliness", label: "Recognition timeliness", score: 20, measured: true, flagged: false, detail: "" },
  { key: "neutrality", label: "Neutrality", score: 20, measured: true, flagged: false, detail: "" },
  { key: "completeness", label: "Completeness", score: 22, measured: true, flagged: false, detail: "" },
  { key: "realization", label: "Cash realization", score: 22, measured: true, flagged: false, detail: "" },
];

/** A card with `measuredCount` of its four dimensions carrying real inputs. */
function mkCard(measuredCount: number, totalScore = 84): EarningsQualityCard {
  return {
    totalScore,
    timeliness: 20, neutrality: 20, completeness: 22, realization: 22,
    remFlag: false,
    label: "High earnings quality",
    flags: [],
    dimensions: DIMENSIONS.map((d, i) => ({ ...d, measured: i < measuredCount })),
  };
}

describe("earningsQualityMetric", () => {
  it("reports the composite the scorecard measured", () => {
    const { value, context } = earningsQualityMetric(buildEarningsQualitySummary(mkCard(4)));

    // Out of 100, not as a percentage: the old tile's `/ 100` plus `format="pct"`
    // was the arithmetic that made a fidelity score look like a quality score.
    expect(value).toBe("84/100");
    expect(context).toBe("4 of 4 dimensions measured");
  });

  it("says how much of the composite was measured, so a partial one cannot pass for whole", () => {
    // Same score, different evidence behind it. Two of the four dimensions here
    // are the card's neutral placeholders, which is not visible in the number.
    const partial = earningsQualityMetric(buildEarningsQualitySummary(mkCard(2)));

    expect(partial.value).toBe("84/100");
    expect(partial.context).toBe("2 of 4 dimensions measured");
    expect(partial.context).not.toBe(
      earningsQualityMetric(buildEarningsQualitySummary(mkCard(4))).context,
    );
  });

  it("shows no score when every dimension was a placeholder", () => {
    // `buildEarningsQualityCard` scores all four dimensions whether or not their
    // inputs existed, so an all-null card still totals 51/100 and calls itself
    // "moderate". 51% on the landing surface would be a fabricated assessment.
    const summary = buildEarningsQualitySummary(mkCard(0, 51));

    expect(summary.totalScore).toBeNull();
    const { value, context } = earningsQualityMetric(summary);
    expect(value).toBeNull();
    expect(context).toBe("No dimension had inputs");
  });

  it("distinguishes no scorecard from a scorecard with nothing to score", () => {
    // Both render an em dash, so the reason has to be legible in the context
    // line: no scorecard was built at all is a different fact from a scorecard
    // that ran and found no inputs, and it sends the reviewer somewhere else.
    const noCard = earningsQualityMetric(buildEarningsQualitySummary(null));

    expect(noCard.value).toBeNull();
    expect(noCard.context).toBe("No scorecard for this run");
    expect(noCard.context).not.toBe(
      earningsQualityMetric(buildEarningsQualitySummary(mkCard(0, 51))).context,
    );
  });

  it("treats a missing envelope field like a run with no scorecard", () => {
    // `earningsQuality` is optional on the envelope and absent on persisted
    // envelopes written before schema v22, so both null and undefined arrive here.
    const absent = { value: null, context: "No scorecard for this run" };
    expect(earningsQualityMetric(null)).toEqual(absent);
    expect(earningsQualityMetric(undefined)).toEqual(absent);
  });

  it("does not claim the run never valued, which it cannot know", () => {
    // `DashboardView` builds its own command center and prints an intrinsic value
    // from it; this signal comes from the one in `useAuditAnalysis`, which is
    // wrapped in try/catch. "No valuation ran" beside a displayed valuation would
    // be the same kind of false sentence the tile is being fixed for.
    for (const summary of [null, buildEarningsQualitySummary(null), buildEarningsQualitySummary(mkCard(0, 51))]) {
      expect(earningsQualityMetric(summary).context).not.toContain("valuation");
    }
  });

  it("rounds rather than printing a composite with a decimal point", () => {
    const { value } = earningsQualityMetric(buildEarningsQualitySummary(mkCard(4, 71.5)));

    // The card rounds its own total, but the summary carries whatever it was
    // given, and "71.5/100" claims a precision four 25-point buckets do not have.
    expect(value).toBe("72/100");
  });
});
