/* ================================================================
   That the EV/EBITDA cross-check tiles say what they claim to say.

   The "Peer count" tile rendered `evEbitda.label` — a semicolon-joined
   summary that begins `EBITDA_T: <n>` and contains no count in any code
   path, because until now the engine reported none. So a reviewer read
   an EBITDA figure under the heading "Peer count".

   `config.ev_ebitda_peers` is the only source of peer multiples and
   nothing in the app writes it (no UI control, absent from
   DEFAULT_CONFIG, absent from every company data file and market pack).
   So in production the count is 0, every peer tile is blank, and the
   panel reads as broken rather than unconfigured — hence the note.

   Renders the real component against the real command center, because
   both defects are in what a genuine engine output gets displayed as.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SotpSection from "../SotpSection";
import { buildValuationCommandCenter } from "../../../engine/valuationCommandCenter";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../../engine/types";
import { CroreShares, INRAbsolute } from "../../../engine/types/units";

const EBITDA = 140;

function mkPeriod(period_end: string, cse: number): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: cse, MI: 0, FA: 100, FO: 50, OA: 900, OL: 250,
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
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA,
    } as RecastPeriod["cf"],
    ratios: {} as RecastPeriod["ratios"],
  } as RecastPeriod;
}

/**
 * `sotp_preset: "ITC"` is what makes the panel render at all — `SotpSection`
 * returns null unless `commandCenter.sotp` is non-null, and with no parsed
 * segment data the preset branch is the only other way there
 * (`valuationCommandCenter/builders.ts:56`).
 */
function render(peers?: EngineConfig["ev_ebitda_peers"]): string {
  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    sotp_preset: "ITC",
    shares_outstanding: CroreShares(100),
    market_price: INRAbsolute(500),
    ...(peers ? { ev_ebitda_peers: peers } : {}),
  };
  const commandCenter = buildValuationCommandCenter({
    data: [mkPeriod("2024-03-31", 850), mkPeriod("2025-03-31", 900)],
    config,
  });
  return renderToStaticMarkup(<SotpSection commandCenter={commandCenter} />);
}

/**
 * The rendered text of the tile whose label is `label` — just the value, not
 * the surrounding markup. Returning the markup would make assertions vacuous:
 * `toContain("0")` passes on the `text-slate-900` class name alone.
 */
function tileValue(html: string, label: string): string {
  const at = html.indexOf(`>${label}</div>`);
  expect(at).toBeGreaterThan(-1);
  const match = /<div class="mt-1[^"]*">([\s\S]*?)<\/div>/.exec(html.slice(at));
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("SotpSection — the peer-count tile", () => {
  it("shows a count, not the EBITDA the label string starts with", () => {
    const html = render();
    const tile = tileValue(html, "Peer count");

    // The old value was `label`, which always begins `EBITDA_T: <n>`. With no
    // peers configured the tile therefore showed this company's EBITDA under a
    // heading promising a number of peers.
    expect(tile).not.toContain("EBITDA_T");
    expect(tile).not.toContain(`${EBITDA}`);
    expect(tile).toContain("0");
  });

  it("counts the peers a caller actually configured", () => {
    const tile = tileValue(
      render([
        { company: "PeerA", evEbitda: 12 },
        { company: "PeerB", evEbitda: 14 },
        { company: "PeerC", evEbitda: 9 },
      ]),
      "Peer count",
    );

    expect(tile).toContain("3");
    expect(tile).not.toContain("EBITDA_T");
  });

  it("does not count peers whose multiple could not be used", () => {
    // Positive control against counting the supplied array: only one of these
    // reaches the median, so any other number overstates the evidence behind
    // the peer figures displayed beside it.
    const tile = tileValue(
      render([
        { company: "Real", evEbitda: 12 },
        { company: "Missing", evEbitda: null },
        { company: "Negative", evEbitda: -4 },
      ]),
      "Peer count",
    );

    expect(tile).toContain("1");
  });
});

describe("SotpSection — a cross-check with no usable peer says so", () => {
  it("explains the blank peer tiles instead of showing a row of dashes", () => {
    const html = render();

    // Same principle as a skipped valuation card naming its blocker: absent
    // input and broken panel look identical when both render "—".
    expect(html).toContain("No usable peer multiple");
    expect(html).toContain("not computed");
  });

  it("does not claim nothing was configured when what was configured was unusable", () => {
    // A zero count has two causes, and the note first read "No peer multiples
    // are configured", which is false for this one: three peers were supplied
    // and all three were dropped before the median. Only reachable by a future
    // caller today, but a wrong reason sends the reviewer to look for a missing
    // config rather than at the peer values they entered.
    const html = render([
      { company: "Missing", evEbitda: null },
      { company: "Zero", evEbitda: 0 },
      { company: "Negative", evEbitda: -4 },
    ]);

    expect(tileValue(html, "Peer count")).toContain("0");
    expect(html).toContain("No usable peer multiple");
    expect(html).not.toContain("configured");
  });

  it("drops the note once a peer multiple exists", () => {
    const html = render([{ company: "PeerA", evEbitda: 12 }]);

    expect(html).not.toContain("No usable peer multiple");
    // And the peer figures the note stood in for are now real.
    expect(tileValue(html, "Peer median EV/EBITDA")).toContain("12.0x");
  });
});
