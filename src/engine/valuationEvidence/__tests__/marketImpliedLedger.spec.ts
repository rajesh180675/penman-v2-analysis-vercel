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

  it("judges implied terminal ROIC against kw, not against the growth anchor", () => {
    // An ordinary case: implied terminal ROIC 20%, kw 12%, growth anchor 8%.
    const ordinary: ReverseDcfDiagnostics = { ...diagnostics, impliedOwnerEarningsGrowth: 0.1, impliedTerminalROIC: 0.2, impliedKE: 0.12 };
    const ledger = buildMarketImpliedExpectationLedger({ marketPrice: 100, asOf: null, reverseDcf: ordinary, operatingCapitalCharge: 0.12 });
    const roic = ledger.rows.find((row) => row.key === "implied_terminal_roic")!;
    expect(roic.comparisonAnchor).toBe(0.12);
    expect(roic.gap).toBeCloseTo(0.08, 12);
    // 20% > 1.5 × 12%: optimistic on the right basis. Against the 8% growth
    // anchor it was "optimistic" whatever kw was — 20% would pass even at kw 15%.
    expect(roic.interpretation).toBe("optimistic");
    const fair = buildMarketImpliedExpectationLedger({ marketPrice: 100, asOf: null, reverseDcf: ordinary, operatingCapitalCharge: 0.15 });
    expect(fair.rows.find((row) => row.key === "implied_terminal_roic")!.interpretation).toBe("reasonable");
  });

  it("leaves the terminal-ROIC row unanchored when kw is not supplied", () => {
    const ledger = buildMarketImpliedExpectationLedger({ marketPrice: 100, asOf: null, reverseDcf: { ...diagnostics, impliedTerminalROIC: 0.2 } });
    const roic = ledger.rows.find((row) => row.key === "implied_terminal_roic")!;
    expect(roic.comparisonAnchor).toBeNull();
    expect(roic.gap).toBeNull();
  });

  it("returns unavailable rows without inventing implied expectations when reverse DCF is absent", () => {
    const ledger = buildMarketImpliedExpectationLedger({ marketPrice: null, asOf: null, reverseDcf: null });

    expect(ledger.intrinsicConfidenceEffect).toBe("none");
    expect(ledger.rows.every((row) => row.interpretation === "unavailable")).toBe(true);
    expect(ledger.rows.every((row) => row.value === null)).toBe(true);
  });
});
