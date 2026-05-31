import { describe, expect, it } from "vitest";
import { buildClassAModels } from "../builders";
import { DEFAULT_CONFIG, RecastPeriod } from "../../types";

/**
 * S-9.4C / clean-surplus regression.
 *
 * The clean-surplus identity is ΔCommonEquity = CI − Dividends + NetIssuance.
 * `commonEquity` is recast CSE, which EXCLUDES minority interest
 * (CSE = totalSE − MI). The comprehensive-income basis must therefore be
 * parent-attributable too. Group TCI includes the NCI share, so the basis is
 * `TCI − TCI_NCI`. Feeding raw group TCI makes every period's residual absorb
 * the minority's CI and flags a phantom dirty-surplus for any firm with
 * non-wholly-owned subsidiaries.
 *
 * Triangulated so it proves the fix is LIVE rather than merely green:
 *   - Run A: no minority (TCI_NCI = 0).
 *   - Run B: identical parent economics, but group TCI inflated by a large NCI
 *     share with TCI_NCI set to match.
 * Under the parent basis both runs see the same parent CI, so the verdict and
 * residual must be identical and clean. If the basis were raw TCI, Run B's
 * inflated income would force a material-dirty verdict — the equivalence below
 * can only hold if NCI is stripped.
 */

function mkCleanSurplusPeriod(args: {
  year: number;
  cse: number;
  parentCI: number;
  dividends: number; // positive magnitude paid
  nciShare: number; // minority's share folded into group TCI
}): RecastPeriod {
  const { year, cse, parentCI, dividends, nciShare } = args;
  return {
    period_end: `${year}-03-31`,
    bs: {
      CSE: cse,
      TradeReceivables: 55,
      Inventory: 35,
      TradePayables: 40,
    },
    is: {
      Sales: 1000,
      COGS: 580,
      // Group TCI carries the minority's share; TCI_NCI records it so the
      // parent basis (TCI − TCI_NCI) recovers parentCI exactly.
      TCI: parentCI + nciShare,
      TCI_NCI: nciShare,
    },
    cf: {
      DividendPaid: -dividends, // builder takes Math.abs
      EquityIssued: 0,
      ShareBuybacks: 0,
      FCF_cash: 120,
    },
  } as unknown as RecastPeriod;
}

// Parent economics: constant parent CI = 100, dividends = 30, no issuance.
// Expected ΔCSE = 100 − 30 = 70 each period → CSE walks 500 → 570 → 640.
function series(nciShare: number): RecastPeriod[] {
  return [
    mkCleanSurplusPeriod({ year: 2023, cse: 500, parentCI: 100, dividends: 30, nciShare }),
    mkCleanSurplusPeriod({ year: 2024, cse: 570, parentCI: 100, dividends: 30, nciShare }),
    mkCleanSurplusPeriod({ year: 2025, cse: 640, parentCI: 100, dividends: 30, nciShare }),
  ];
}

describe("clean-surplus charges comprehensive income on the parent (ex-NCI) basis", () => {
  it("strips the minority share so a clean parent series stays clean despite large NCI", () => {
    const withoutNci = buildClassAModels(series(0), DEFAULT_CONFIG, series(0)[2]!, 10, null, 0.12);
    // NCI share 4× the parent's CI — would dominate the residual under raw TCI.
    const withNci = buildClassAModels(series(400), DEFAULT_CONFIG, series(400)[2]!, 10, null, 0.12);

    expect(withoutNci.cleanSurplusResult).not.toBeNull();
    expect(withNci.cleanSurplusResult).not.toBeNull();

    // Parent series reconciles exactly → clean in both runs.
    expect(withoutNci.cleanSurplusResult!.overall).toBe("clean");
    // The load-bearing assertion: a huge minority share does NOT corrupt the
    // verdict. Raw group TCI would make this material-dirty.
    expect(withNci.cleanSurplusResult!.overall).toBe("clean");

    // Equivalence: stripping NCI makes the two runs numerically identical.
    expect(withNci.cleanSurplusResult!.worstResidualRatio)
      .toBeCloseTo(withoutNci.cleanSurplusResult!.worstResidualRatio, 10);
  });
});
