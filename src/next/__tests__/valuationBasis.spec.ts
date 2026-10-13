import { describe, expect, it } from "vitest";
import { valuationDateNote } from "../ui/valuationBasis";

const cc = (marketContext: Partial<Parameters<typeof valuationDateNote>[0]["marketContext"]>, marketPrice: number | null = 1334) => ({
  marketPrice,
  anchorPeriod: { period_end: "2025-03-31" },
  marketContext: { priceDate: "2026-10-13", yearsToPriceDate: 1.54, sharesAtValuationDate: 96.42, sharesAtPriceDate: null, shareCountChange: null, ...marketContext },
});

describe("valuationDateNote", () => {
  it("says the values are at the valuation date, and how the Verdict's beside the price differ", () => {
    // Nestlé: carried 1.5 years, and a 1:1 bonus since.
    expect(valuationDateNote(cc({ sharesAtPriceDate: 192.83, shareCountChange: 2 }))).toBe(
      "Per share at the valuation date, 2025-03-31, on that date's 96.42 crore shares. Beside the price the Verdict carries values to the price's date, 2026-10-13 and spreads them over today's 192.83 crore shares, so its figures differ from these.",
    );
    expect(valuationDateNote(cc({}))).toBe(
      "Per share at the valuation date, 2025-03-31, on that date's 96.42 crore shares. Beside the price the Verdict carries values to the price's date, 2026-10-13, so its figures differ from these.",
    );
  });

  it("says nothing when the Verdict's figures are these: no price, nothing carried, the count unchanged", () => {
    expect(valuationDateNote(cc({}, null))).toBeNull();
    expect(valuationDateNote(cc({ yearsToPriceDate: 0, shareCountChange: 1.004, sharesAtPriceDate: 96.8 }))).toBeNull();
  });
});
