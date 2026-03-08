import { describe, expect, it } from "vitest";
import { convergenceByHalfMeans } from "../monteCarloMath";

describe("convergenceByHalfMeans", () => {
  it("handles odd-length samples with correct half denominators", () => {
    const samples = [
      ...new Array(50).fill(100),
      ...new Array(51).fill(101.95),
    ];

    // With correct odd-split means, relative gap is below 2%.
    expect(convergenceByHalfMeans(samples, 0.02)).toBe(true);
  });

  it("returns false for zero global mean", () => {
    expect(convergenceByHalfMeans([1, -1], 0.02)).toBe(false);
  });
});
