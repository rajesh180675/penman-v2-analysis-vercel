/* ================================================================
   That a skipped valuation card always says why it skipped.

   `ValCard` decides a card is skipped from `value == null` and renders
   `skipReason` only inside that branch. The RE card used to pass a
   reason gated on `equityModelsBlocked` alone, but `V_RE` is null when
   `equityModelsBlocked || CV_RE_3 == null` (`PenmanNissimEngine.ts:372`).
   So a Gordon-spread skip with healthy net worth rendered a bare
   "— Skipped" with nothing beside it — which reads the same as a card
   nobody wired up.

   Reachable by typing, not by a corrupt file: `cv` defaults to CV3, and
   the Growth g input is an unclamped `<input type="number">`
   (`atoms.tsx:44`) feeding local state, so g above ke is one keystroke.
   That path also bypasses `validateEngineConfig`'s `g >= ke` error,
   which reads `cfg.terminal_growth_rate` — a different value.

   Renders the real component against the real engine, because the
   defect is in which reason a genuine null carries.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ValuationCardsSection from "../ValuationCardsSection";
import { makeCvSel, type CVMethod } from "../ValuationReport.formatters";
import { computeValuation } from "../../../engine/PenmanNissimEngine";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../../engine/types";

function mkPeriod(period_end: string, CSE: number): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE, MI: 0, FA: 100, FO: 50, OA: 900, OL: 250,
      NOA: 700, NFO: -50, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 300, CurrentLiabilities: 200,
      Inventory: 40, TradeReceivables: 60, TradePayables: 50,
      PPE: 250, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 40, OA_TradeReceivables: 60, OA_DTA: 0, OA_CWIP: 0, OA_Other: 550,
      OL_TradePayables: 50, OL_OtherCurrentLiabilities: 40,
      OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
    } as RecastPeriod["bs"],
    is: {
      Sales: 1000, TaxExpense: 25, taxRate: 0.25, PAT: 115, OCI: 0, TCI: 115, TCI_NCI: 0,
      CNI: 115, FinanceCost: 12, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 6, OI: 125, OtherItems: 0, OI_from_sales: 125, MII: 0, COGS: 600,
    } as RecastPeriod["is"],
    cu: {
      UOI: 0, CoreOI: 125, UFE: 0, CoreNFE: 6,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as RecastPeriod["cu"],
    cf: {
      CFO: 140, Capex: 30, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 90, FCF_cash: 110,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    } as RecastPeriod["cf"],
    ratios: {} as RecastPeriod["ratios"],
  } as RecastPeriod;
}

const KE = 0.12;
const KW = 0.11;

/**
 * Healthy equity, so `equityModelsBlocked` is false and only the guard can bite.
 *
 * `forceReOINull` overrides the computed `V_ReOI` prop. Needed because
 * `V_ReOI_CV01`/`CV02` are typed `number`, not `number | null`
 * (`types/valuation.ts:48`), so no engine input produces a null there — the
 * component's contract is nonetheless the prop it is handed, and the fallback
 * behind that prop should still be a true sentence.
 */
function render({ g, cv = "CV3", forceReOINull = false }: { g: number; cv?: CVMethod; forceReOINull?: boolean }): string {
  const periods = [mkPeriod("2024-03-31", 850), mkPeriod("2025-03-31", 900)];
  const val = computeValuation(periods, KE, KW, g, DEFAULT_CONFIG);
  const cvSel = makeCvSel(cv);
  return renderToStaticMarkup(
    <ValuationCardsSection
      val={val}
      V_RE={cvSel(val.V_RE_CV1, val.V_RE_CV2, val.V_RE_CV3)}
      V_ReOI={forceReOINull ? null : cvSel(val.V_ReOI_CV01, val.V_ReOI_CV02, val.V_ReOI_CV03)}
      cv={cv}
      sharesOut={100}
    />,
  );
}

/**
 * Skipped cards that render no reason after the "— Skipped" headline — the
 * state under test. `ValCard` puts the reason in a `text-xs` div immediately
 * after, so a skip whose next element is anything else is a bare one.
 */
function bareSkipCount(html: string): number {
  const skips = html.match(/— Skipped<\/div>/g)?.length ?? 0;
  const explained = html.match(/— Skipped<\/div><div class="text-xs/g)?.length ?? 0;
  return skips - explained;
}

describe("ValuationCardsSection — a skipped card names its blocker", () => {
  it("explains a Gordon-spread skip instead of showing a bare — Skipped", () => {
    // g above ke: the RE and ReOI continuing values both go null while net
    // worth is healthy, which is the case the old gating could not see.
    const html = render({ g: 0.15 });
    expect(html).toContain("— Skipped");
    expect(bareSkipCount(html)).toBe(0);
    // The guard's own wording, carrying the two rates that actually collided,
    // rather than a generic "unavailable".
    expect(html).toContain("terminal growth 15.00%");
    expect(html).toContain("cost of equity 12.00%");
  });

  it("does not blame negative net worth when equity is positive", () => {
    // The wrong reason is as bad as none: it sends the reader to the balance
    // sheet for a problem that is in the assumptions panel.
    expect(render({ g: 0.15 })).not.toContain("negative net worth");
  });

  it("names the operating capital cost on the ReOI card", () => {
    // Each card must cite its own discount rate. The ReOI side continues at
    // kw, so quoting ke there would be precise-looking and wrong.
    expect(render({ g: 0.15 })).toContain("operating capital cost 11.00%");
  });

  it("still publishes both values when the spread is positive", () => {
    // Positive control. Without it, every assertion above would hold just as
    // well if the cards had started skipping unconditionally.
    const html = render({ g: 0.04 });
    expect(html).not.toContain("— Skipped");
    expect(html).toContain("/ share");
  });

  it("does not borrow the Gordon wording for CV1", () => {
    // CV1 is a zero continuing value and CV2 a no-growth perpetuity — neither
    // divides by (rate − g), so neither can trip the spread guard. A guard
    // reason surfacing there would be describing a computation that did not
    // run for the selected method.
    const html = render({ g: 0.15, cv: "CV1" });
    expect(html).not.toContain("terminal growth 15.00%");
  });

  it("keeps the CV1 ReOI fallback free of Gordon wording", () => {
    // The test above renders a non-skipped ReOI card, so it never reaches the
    // fallback and cannot catch its wording. Forcing the null does.
    //
    // `gordonGuardReason` returns null off CV3 by design, so before this the
    // fallback claimed "terminal growth must be below operating capital cost"
    // for a method that has no terminal growth term at all — a precise-sounding
    // sentence about arithmetic that did not run.
    const html = render({ g: 0.04, cv: "CV1", forceReOINull: true });

    expect(html).toContain("— Skipped");
    expect(bareSkipCount(html)).toBe(0);
    expect(html).toContain("ReOI value unavailable for the selected continuing-value method");
    expect(html).not.toContain("terminal growth must be below operating capital cost");
  });

  it("still names the terminal growth on a CV3 fallback", () => {
    // Positive control for the split above: the method-specific sentence must
    // survive under CV3, or the fix would have traded a wrong reason for a
    // uselessly generic one everywhere.
    //
    // g below kw, so `gordonCv` pushes no guard and the fallback is what
    // renders — the one path where CV3's own wording is the right answer.
    const html = render({ g: 0.04, cv: "CV3", forceReOINull: true });

    expect(html).toContain("terminal growth must be below operating capital cost");
    expect(html).not.toContain("ReOI value unavailable for the selected");
  });
});
