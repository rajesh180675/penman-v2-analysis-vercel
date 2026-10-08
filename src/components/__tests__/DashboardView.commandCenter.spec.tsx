/** @vitest-environment jsdom */

/* ================================================================
   That the dashboard's "Intrinsic Value" tile shows the Valuation
   tab's valuation.

   The dashboard built its own command center from the recast as
   filed. Since the run values a lending arm's parent with the arm
   carved out (#412) and a transition year restated (#416), that
   build put M&M, L&T, Grasim and Nestlé on another basis than the
   Valuation tab, which takes the run's command center. The
   dashboard now takes it the same way, and builds its own only
   when there is no run.
================================================================ */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import DashboardView from "../dashboard/DashboardView";
import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../../engine/marketPacks";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../engine/types";
import { CroreShares, INRAbsolute } from "../../engine/types/units";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mkPeriod(period_end: string, cse: number): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: cse, MI: 0, FA: 100, FO: 50, OA: 900, OL: 250,
      NOA: 700, NFO: -50, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 40, TradeReceivables: 60, TradePayables: 50,
      PPE: 250, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 40, OA_TradeReceivables: 60,
      OA_DTA: 0, OA_CWIP: 0, OA_Other: 550,
      OL_TradePayables: 50, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
    } as RecastPeriod["bs"],
    is: {
      Sales: 1000, TaxExpense: 25, taxRate: 0.25, PAT: 115, OCI: 0, TCI: 115, TCI_NCI: 0,
      CNI: 115, FinanceCost: 12, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 6, OI: 125, OtherItems: 0, OI_from_sales: 125, MII: 0, COGS: 600,
    } as RecastPeriod["is"],
    cu: { UOI: 0, CoreOI: 125, UFE: 0, CoreNFE: 6, ExceptionalItemsAfterTax: 0, OCITotal: 0 } as RecastPeriod["cu"],
    cf: {
      CFO: 140, Capex: 30, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0, InterestReceived: 0, DividendReceived: 0,
      FCF_accounting: 90, FCF_cash: 110, d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    } as RecastPeriod["cf"],
    ratios: { PM: 0.115, ATO: 1.4, FLEV: 0.18, ROCE: 0.16 } as RecastPeriod["ratios"],
  } as RecastPeriod;
}

const config: EngineConfig = { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100), market_price: INRAbsolute(500) };
const data = [mkPeriod("2024-03-31", 850), mkPeriod("2025-03-31", 900)];
const roots: Root[] = [];

async function intrinsicTile(commandCenter: ReturnType<typeof buildValuationCommandCenter> | null): Promise<string> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<DashboardView data={data} config={config} itServices={null} commandCenter={commandCenter} />);
  });
  const tile = [...container.querySelectorAll(".wb-metric")]
    .find((el) => el.querySelector(".wb-metric-label")?.textContent === "Intrinsic Value");
  expect(tile, "the Intrinsic Value tile should be rendered").toBeDefined();
  return tile!.textContent ?? "";
}

afterEach(() => {
  for (const root of roots) act(() => { root.unmount(); });
  roots.length = 0;
  document.body.replaceChildren();
});

describe("DashboardView — the Intrinsic Value tile", () => {
  it("shows the run's valuation when there is one", async () => {
    const built = buildValuationCommandCenter({ data, config });
    const run = { ...built, range: { floorPerShare: 4321, ceilingPerShare: 8765 } };
    expect(await intrinsicTile(run)).toContain("₹4321–8765");
  });

  it("builds its own from the recast when there is no run", async () => {
    // The dashboard's own inputs: the recast, no market snapshot, the packs.
    const built = buildValuationCommandCenter({ data, config, marketData: null, analysisStatus: null, segmentData: null, ...ACTIVE_MARKET_PACKS, analysisAsOf: analysisAsOfToday() });
    expect(built.range.floorPerShare).not.toBeNull();
    const text = await intrinsicTile(null);
    expect(text).not.toContain("₹4321–8765");
    expect(text).toContain(`₹${built.range.floorPerShare!.toFixed(0)}–${built.range.ceilingPerShare!.toFixed(0)}`);
  });
});
