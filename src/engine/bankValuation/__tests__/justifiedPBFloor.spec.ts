import { describe, expect, it } from "vitest";
import { justifiedPBGordon } from "../coreModels";

describe("justifiedPBGordon floor", () => {
  it("floors a value-destroying lender at 0.3x and says so", () => {
    const result = justifiedPBGordon(1000, 0.05, 0.14, 0.05, null, false);
    expect(result.intrinsicValue).toBeCloseTo(300, 6);
    // The reason used to say "0.7x … insurance" for every floored company.
    expect(result.reason).toContain("0.3x");
    expect(result.reason).not.toContain("insurance");
  });

  it("floors an insurer at 0.7x", () => {
    const result = justifiedPBGordon(1000, 0.05, 0.14, 0.05, null, true);
    expect(result.intrinsicValue).toBeCloseTo(700, 6);
    expect(result.reason).toContain("0.7x");
    expect(result.reason).toContain("insurance");
  });
});
