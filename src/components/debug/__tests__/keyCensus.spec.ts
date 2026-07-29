/* ================================================================
   parsedKeyCensus: the two headline key counts, on one basis.

   The banner and head tiles paired `metrics.totalCompositeKeys` with
   `metrics.totalBaseKeys`. The first is incremented inside the
   per-period loop (`capitalineParser.ts:517`) so it is a sum over
   periods; the second is `firstPeriodKeys.length` (`:596`), one
   period's count. Measured: Bajaj Finance showed 11770 beside 75 and
   read as 157:1 composite-to-base, when the distinct counts are 1065
   and 1048 — a ratio of 1.02:1.

   Fixtures give periods DIFFERENT key sets. A fixture whose periods
   share one key set cannot tell a distinct count from a per-period
   sum, so it would pin nothing.
================================================================ */

import { describe, expect, it } from "vitest";
import { censusBasisNote, parsedKeyCensus } from "../keyCensus";
import type { CapitalineParseDebug } from "../../../engine/capitalineParser";
import type { RawPeriodData } from "../../../engine/types";

function period(period_end: string, values: Record<string, number | null>): RawPeriodData {
  return { company_id: "TEST", period_end, raw_metric_values: values };
}

function mkDebug(totals: { composite: number; base: number }): CapitalineParseDebug {
  return {
    companyId: "TEST",
    files: [],
    detectedPeriods: [],
    sourceArtifactHashes: [],
    rawGrids: [],
    metrics: {
      totalCompositeKeys: totals.composite,
      totalBaseKeys: totals.base,
      baseKeyCollisions: [],
      byStatement: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 },
    },
    warnings: [],
    sample: { firstRows: [] },
    rawMetricKeys: [],
  };
}

/** Two periods sharing one composite and one base key, each with one of its own. */
function twoPeriods(): RawPeriodData[] {
  return [
    period("2024-03-31", {
      "Sales__ProfitLoss": 100,
      "Excise Duty__ProfitLoss": 5,
      Sales: 100,
      "Excise Duty": 5,
    }),
    period("2025-03-31", {
      "Sales__ProfitLoss": 200,
      "Gold Loans__BalanceSheet": 50,
      Sales: 200,
      "Gold Loans": 50,
    }),
  ];
}

describe("parsedKeyCensus counts distinct keys, not per-period reads", () => {
  it("counts a key appearing in every period once", () => {
    // The defect in one assertion. The parser would report 4 composite reads
    // here (2 per period); there are 3 distinct composite keys.
    const census = parsedKeyCensus(twoPeriods(), mkDebug({ composite: 4, base: 2 }));
    expect(census.compositeKeys).toBe(3);
  });

  it("counts base keys across all periods, not just the oldest", () => {
    // `totalBaseKeys` is the oldest period's count — 2 here. The union is 3:
    // "Gold Loans" only exists in 2025.
    const census = parsedKeyCensus(twoPeriods(), mkDebug({ composite: 4, base: 2 }));
    expect(census.baseKeys).toBe(3);
  });

  it("puts both counts on the same basis", () => {
    // The point of the fix: the pair is now comparable. Bajaj Finance is 1065
    // composite to 1048 base — near parity, not the 157:1 the banner implied.
    const census = parsedKeyCensus(twoPeriods(), mkDebug({ composite: 11770, base: 75 }));
    expect(census).toEqual({ compositeKeys: 3, baseKeys: 3, periodsCounted: 2 });
  });

  it("splits on the __ suffix, so neither count includes the other's keys", () => {
    const census = parsedKeyCensus(
      [period("2025-03-31", { "Sales__ProfitLoss": 1, Sales: 1, "Total Assets": 2 })],
      mkDebug({ composite: 1, base: 2 }),
    );
    expect(census.compositeKeys).toBe(1);
    expect(census.baseKeys).toBe(2);
  });

  it("counts a key whose value parsed as null", () => {
    // Presence is what the parser counted too: a key it extracted but could not
    // read as a number was still extracted.
    const census = parsedKeyCensus(
      [period("2025-03-31", { Sales: null, "Sales__ProfitLoss": null })],
      mkDebug({ composite: 0, base: 0 }),
    );
    expect(census).toEqual({ compositeKeys: 1, baseKeys: 1, periodsCounted: 1 });
  });

  it("reports how many periods it measured over", () => {
    expect(parsedKeyCensus(twoPeriods(), mkDebug({ composite: 4, base: 2 })).periodsCounted)
      .toBe(2);
  });
});

describe("parsedKeyCensus falls back to parser totals with no periods", () => {
  it("uses the parser's own totals when there is no rawData", () => {
    const census = parsedKeyCensus(null, mkDebug({ composite: 11770, base: 75 }));
    expect(census).toEqual({ compositeKeys: 11770, baseKeys: 75, periodsCounted: 0 });
  });

  it("reports periodsCounted 0 so a caller can tell the pair is not comparable", () => {
    // The fallback pair IS the mismatched one. `periodsCounted: 0` is how the
    // note below knows to say so rather than let the two numbers imply a ratio.
    expect(parsedKeyCensus([], mkDebug({ composite: 4, base: 1 })).periodsCounted).toBe(0);
  });

  it("returns zeros when there is nothing anywhere", () => {
    expect(parsedKeyCensus(null, null)).toEqual({
      compositeKeys: 0,
      baseKeys: 0,
      periodsCounted: 0,
    });
  });
});

describe("censusBasisNote states the basis the counts share", () => {
  it("names the period count when there is more than one period", () => {
    const note = censusBasisNote({ compositeKeys: 3, baseKeys: 3, periodsCounted: 12 });
    expect(note).toBe("Distinct keys across all 12 periods.");
  });

  it("says nothing for a single period, where distinctness is vacuous", () => {
    expect(censusBasisNote({ compositeKeys: 3, baseKeys: 3, periodsCounted: 1 })).toBeNull();
  });

  it("warns that the fallback pair is not comparable", () => {
    const note = censusBasisNote({ compositeKeys: 11770, baseKeys: 75, periodsCounted: 0 });
    expect(note).toContain("Not comparable");
  });

  it("says nothing when a failed parse leaves both counts at zero", () => {
    // 0 beside 0 is not a mismatched pair, and the warning would render under
    // "Parse failed — 0 periods" where it only adds noise.
    expect(censusBasisNote({ compositeKeys: 0, baseKeys: 0, periodsCounted: 0 })).toBeNull();
  });
});
