import { describe, expect, it } from "vitest";
import { DEMERGED_SHARE_OF_OI_MAX, immaterialDemerger } from "../demergerEvidence";

// ITC FY25: ₹15,016 Cr discontinued (ITC Hotels); the FY24 comparative files
// ₹561 Cr of ₹22,439 Cr operating income.
const itc = { dirtySurplus: -21_614, discontinuedAfterTax: 15_016, previousDiscontinuedAfterTax: 561, previousOI: 22_439 };

describe("immaterialDemerger", () => {
  it("measures the demerged business's share of the prior year's operating income", () => {
    expect(immaterialDemerger(itc)?.priorShareOfOI).toBeCloseTo(561 / 22_439, 9);
  });

  it("needs equity to have left: a positive residual is no distribution", () => {
    expect(immaterialDemerger({ ...itc, dirtySurplus: 21_614 })).toBeNull();
  });

  it("needs the year to file a discontinued operation", () => {
    expect(immaterialDemerger({ ...itc, discontinuedAfterTax: 0 })).toBeNull();
    expect(immaterialDemerger({ ...itc, discontinuedAfterTax: undefined })).toBeNull();
  });

  it("fails closed without the restated comparative or a positive prior OI", () => {
    expect(immaterialDemerger({ ...itc, previousDiscontinuedAfterTax: 0 })).toBeNull();
    expect(immaterialDemerger({ ...itc, previousOI: -500 })).toBeNull();
  });

  it("refuses a business that was a material part of the history", () => {
    const atLimit = DEMERGED_SHARE_OF_OI_MAX * 22_439;
    expect(immaterialDemerger({ ...itc, previousDiscontinuedAfterTax: atLimit })).not.toBeNull();
    expect(immaterialDemerger({ ...itc, previousDiscontinuedAfterTax: atLimit * 1.01 })).toBeNull();
  });
});
