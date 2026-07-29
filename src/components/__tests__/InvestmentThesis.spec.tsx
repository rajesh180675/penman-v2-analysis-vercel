/* ================================================================
   That the thesis page states no moat finding when there is no moat score.

   `computeMoatScore` fails two different ways, and only one of them
   returns an object. For an IT-services company or a loss-maker it
   returns a full result with `dataSufficient: false` — that path was
   closed in #305. Below three periods it returns `null` outright
   (`moatScoring/industrial.ts:39`), and nothing here handled that: the
   fallback branch reads `decisive?.compositeScore ?? 0`, and `0 >= 40`
   is false, so a missing score printed "shows limited evidence of
   competitive moat" — the adverse reading, drawn from no evidence.

   Reachable on ordinary input. The Thesis tab is gated on having at
   least one recast period (`tabs.ts` `needsData`, `useTabVisibility`),
   so any two-period upload renders this page with `moat === null`.

   These render the real component against the real engines — no scorer
   stub — because the defect is in which branch a genuine `null` reaches.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvestmentThesis from "../InvestmentThesis";
import type { EngineConfig, RecastPeriod } from "../../engine/types";
import { DEFAULT_CONFIG } from "../../engine/types";
import { CroreShares, INRAbsolute } from "../../engine/types/units";

function mkPeriod(period_end: string, sales: number, cni: number): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 150, OA: 850, OL: 250,
      NOA: 600, NFO: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 400, CurrentLiabilities: 200, BridgeDebtTotal: 100,
      Inventory: 90, TradeReceivables: 110, TradePayables: 80,
      PPE: 320, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 320, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 90, OA_TradeReceivables: 110, OA_DTA: 0, OA_CWIP: 0, OA_Other: 330,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 50,
      OL_ProvisionsCurrent: 10, OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 90,
    } as RecastPeriod["bs"],
    is: {
      Sales: sales, TaxExpense: 30, taxRate: 0.25, PAT: cni, OCI: 0, TCI: cni, TCI_NCI: 0,
      CNI: cni, FinanceCost: 10, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 10, OI: cni + 10, OtherItems: 0, OI_from_sales: cni + 10, MII: 0,
      COGS: sales * 0.6,
    } as RecastPeriod["is"],
    cu: {
      UOI: 0, CoreOI: cni + 10, UFE: 0, CoreNFE: 10,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as RecastPeriod["cu"],
    cf: {
      CFO: cni + 30, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0,
      FCF_accounting: cni - 10, FCF_cash: cni - 10,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: cni + 50,
    } as RecastPeriod["cf"],
    ratios: {
      ROCE: 0.15, RNOA: 0.12, SPREAD: 0.09, FLEV: 0.2,
      CoreSalesPM: 0.11, cash_conversion_ratio: 0.9,
    } as RecastPeriod["ratios"],
  } as RecastPeriod;
}

const CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  ticker: "TESTCO",
  shares_outstanding: CroreShares(100),
  market_price: INRAbsolute(700),
};

function render(periodCount: number): string {
  const data = Array.from({ length: periodCount }, (_, i) =>
    mkPeriod(`${2020 + i}-03-31`, 900 + i * 50, 90 + i * 5),
  );
  return renderToStaticMarkup(
    <InvestmentThesis data={data} config={CONFIG} itServices={null} />,
  );
}

describe("InvestmentThesis — a missing moat score is not a moat finding", () => {
  it("says the scorer needs more periods rather than reporting limited moat evidence", () => {
    const html = render(2);
    expect(html).toContain("Moat scoring needs at least 3 periods");
    // The specific wrong claim. It is the adverse end of the scale, which is
    // why an ungated read here is worse than a neutral one: it reads as a
    // finding about the company rather than about the framework's reach.
    expect(html).not.toContain("limited evidence of competitive moat");
    expect(html).not.toContain("moderate evidence of competitive moat");
  });

  it("names the period count it actually had", () => {
    // So the reader can tell "this dataset is too short" from "the scorer is
    // broken", without opening the console.
    expect(render(2)).toContain("has 2");
  });

  it("draws a moat conclusion once the scorer returns one", () => {
    // Positive control. Without it, the assertions above would pass just as
    // well if the fix had suppressed the moat sentence unconditionally.
    const html = render(6);
    expect(html).not.toContain("Moat scoring needs at least 3 periods");
    expect(html).toMatch(/evidence of competitive moat|demonstrates durable competitive advantages|Moat scoring does not apply/);
  });
});
