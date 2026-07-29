/* ================================================================
   How the unmapped-label count is worded in the workspace tile.

   The count itself is covered in
   engine/__tests__/unmappedLabels.spec.ts; this pins the display
   decisions, both of which are there to stop the tile making a claim
   the number does not support: a denominator, so 221 is not read
   against the "Coverage 75%" tile beside it that has a different one,
   and an em dash for the empty period, because "0 of 0" reads as a
   file whose every label mapped.
================================================================ */

import { describe, expect, it } from "vitest";
import { unmappedLabelsMetric } from "../company-workspace/unmappedLabelsMetric";

describe("unmappedLabelsMetric", () => {
  it("shows the count against the labels the file supplied", () => {
    // Infosys, as parsed from the bundled ZIP: 221 unmapped of 235 distinct.
    expect(unmappedLabelsMetric({ unmapped: 221, distinct: 235 })).toBe("221 of 235");
  });

  it("carries the denominator, so a large count is not read as poor mapping", () => {
    // Same count, very different findings. 221 of 235 is a chart of accounts the
    // ontology barely touches; 221 of 1,700 is a long statement it covers well.
    // A bare "221" cannot tell those apart.
    expect(unmappedLabelsMetric({ unmapped: 221, distinct: 235 })).not.toBe(
      unmappedLabelsMetric({ unmapped: 221, distinct: 1700 }),
    );
  });

  it("does not print the count alone", () => {
    // The old tile's whole value was a bare number, which is what let
    // `min(unmapped, 8)` pass for a count. Requiring the denominator in the
    // string means a future single-number regression cannot render here.
    expect(unmappedLabelsMetric({ unmapped: 8, distinct: 235 })).not.toBe("8");
  });

  it("says nothing rather than zero-of-zero when the period has no labels", () => {
    // Arithmetically every label mapped. Reading it that way would be the same
    // false clean bill the tile is being fixed for.
    expect(unmappedLabelsMetric({ unmapped: 0, distinct: 0 })).toBe("—");
  });

  it("reports a fully mapped period as such, not as an em dash", () => {
    // The distinction the case above depends on: nothing to map is not the same
    // fact as everything mapped, and only one of them is good news.
    expect(unmappedLabelsMetric({ unmapped: 0, distinct: 12 })).toBe("0 of 12");
  });
});
