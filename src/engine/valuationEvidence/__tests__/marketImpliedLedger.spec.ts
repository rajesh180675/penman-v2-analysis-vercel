import { describe, expect, it } from "vitest";
import { buildMarketImpliedExpectationLedger } from "../marketImpliedLedger";
import type { ReverseDcfDiagnostics } from "../../valuationCommandCenter";

const diagnostics: ReverseDcfDiagnostics = {
  impliedOwnerEarningsGrowth: 0.40,
  impliedTerminalROIC: 0.82,
  impliedKE: 0.055,
  normalizedGrowthAnchor: 0.08,
  expectationLabel: "MODEL SATURATED",
  narrativeSpace: [],
  spreadVsNormalizedGrowth: 0.32,
  marketExpectationLabel: "Priced for perfection",
};

describe("buildMarketImpliedExpectationLedger", () => {
  it("keeps reverse DCF as a market-expectations diagnostic with no intrinsic confidence effect", () => {
    const ledger = buildMarketImpliedExpectationLedger({
      marketPrice: 4072,
      asOf: "2026-06-02",
      reverseDcf: diagnostics,
    });

    expect(ledger.marketPrice).toBe(4072);
    expect(ledger.intrinsicConfidenceEffect).toBe("none");
    expect(ledger.warning).toContain("does not validate intrinsic value");
    expect(ledger.rows.some((row) => row.key === "implied_growth")).toBe(true);
    expect(ledger.rows.every((row) => row.priceDerived)).toBe(true);
  });

  it("labels cap-hugging reverse DCF outputs as saturated instead of forecasts", () => {
    const ledger = buildMarketImpliedExpectationLedger({
      marketPrice: 4072,
      asOf: "2026-06-02",
      reverseDcf: diagnostics,
    });

    expect(ledger.rows.filter((row) => row.saturated).map((row) => row.key)).toEqual(
      expect.arrayContaining(["implied_growth", "implied_terminal_roic"]),
    );
    expect(ledger.rows.some((row) => row.interpretation === "model_saturated")).toBe(true);
  });

  it("returns unavailable rows without inventing implied expectations when reverse DCF is absent", () => {
    const ledger = buildMarketImpliedExpectationLedger({ marketPrice: null, asOf: null, reverseDcf: null });

    expect(ledger.intrinsicConfidenceEffect).toBe("none");
    expect(ledger.rows.every((row) => row.interpretation === "unavailable")).toBe(true);
    expect(ledger.rows.every((row) => row.value === null)).toBe(true);
  });
});
