/** @vitest-environment jsdom (the tile is inside a collapsed EvidenceItem, so it has to be opened) */

/* ================================================================
   That the dashboard's "Earnings Quality" tile shows earnings
   quality.

   It used to show `traceability.parserFidelity.score / 100` — a
   syntactic measure of how much of the source file was mapped —
   which `QualitySignalPanel` renders in the same grid block under
   its own name. One number, twice on one screen, the second time as
   a different analytical concept: "Earnings Quality 96.0%" told a
   reviewer the accruals had been checked when nothing had.

   The helper's own states are covered in earningsQualityMetric.spec;
   this mounts the real component, because the defect was in which
   value reached the tile, not in how the value was formatted. It
   mounts rather than server-renders because both the tile and the
   panel it duplicated live inside the collapsed "Quality Signals"
   evidence item — a static render emits neither.
================================================================ */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import DashboardView from "../dashboard/DashboardView";
import { buildEarningsQualitySummary } from "../../engine/earningsQualitySummary";
import type { EarningsQualityCard } from "../../engine/earningsQuality";
import type { EarningsQualitySummary } from "../../engine/types/earningsQualitySummary";
import type { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../engine/types";
import { CroreShares, INRAbsolute } from "../../engine/types/units";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The fidelity score the tile used to render, chosen not to collide with any composite below. */
const FIDELITY = 96;

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
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    } as RecastPeriod["cf"],
    ratios: { PM: 0.115, ATO: 1.4, FLEV: 0.18, ROCE: 0.16 } as RecastPeriod["ratios"],
  } as RecastPeriod;
}

function mkCard(measuredCount: number, totalScore: number): EarningsQualityCard {
  const keys = ["timeliness", "neutrality", "completeness", "realization"] as const;
  return {
    totalScore,
    timeliness: 20, neutrality: 20, completeness: 22, realization: 22,
    remFlag: false,
    label: "card label",
    flags: [],
    dimensions: keys.map((key, i) => ({
      key, label: key, score: 20, measured: i < measuredCount, flagged: false, detail: "",
    })),
  };
}

/**
 * A partial envelope, cast: `DashboardView` reads it through optional chaining
 * (`traceability?.parserFidelity?.score`, `traceability?.rigor?.currentLevel`), so
 * the two fields under test are the two that matter. Building a real envelope
 * would drag `buildAnalysisTraceability`'s whole input surface in without making
 * the assertion stronger.
 *
 * Takes the envelope field value rather than a card, because the distinction
 * matters here: a structural-only run puts `null` on the envelope
 * (`analysisTraceability.ts` writes `params.earningsQuality ?? null`, and
 * `useAuditAnalysis` passes null when no command center built), *not* an
 * absent-summary object. Building the fixture from a null card would have this
 * test exercise the projection path while leaving the reachable one uncovered.
 */
function mkEnvelope(earningsQuality: EarningsQualitySummary | null): AnalysisTraceabilityEnvelope {
  return {
    parserFidelity: { score: FIDELITY, status: "pass", summary: "", checks: [] },
    earningsQuality,
  } as unknown as AnalysisTraceabilityEnvelope;
}

/** An envelope from a run that produced a scorecard. */
const withCard = (measuredCount: number, totalScore: number) =>
  mkEnvelope(buildEarningsQualitySummary(mkCard(measuredCount, totalScore)));

/** Roots, not just containers: dropping the DOM node does not unmount React. */
const roots: Root[] = [];

/** Mount the dashboard and expand the evidence item the tile lives in. */
async function mountOpen(traceability: AnalysisTraceabilityEnvelope | null): Promise<HTMLElement> {
  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    shares_outstanding: CroreShares(100),
    market_price: INRAbsolute(500),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <DashboardView
        data={[mkPeriod("2024-03-31", 850), mkPeriod("2025-03-31", 900)]}
        config={config}
        traceability={traceability}
        itServices={null}
      />,
    );
  });

  const toggle = [...container.querySelectorAll("button")]
    .find((b) => b.textContent?.includes("Quality Signals"));
  expect(toggle, "the Quality Signals evidence item should exist").toBeDefined();
  await act(async () => { toggle!.click(); });

  return container;
}

/**
 * The text of the `Metric` tile labelled `label` — that tile only. Searching the
 * whole document would make these assertions vacuous: the fidelity score also
 * appears, legitimately, in `QualitySignalPanel` a few nodes away, which is the
 * entire point of the defect.
 */
function tileText(container: HTMLElement, label: string): string {
  const tile = [...container.querySelectorAll(".wb-metric")]
    .find((el) => el.querySelector(".wb-metric-label")?.textContent === label);
  expect(tile, `a tile labelled "${label}" should be rendered`).toBeDefined();
  return tile!.textContent ?? "";
}

afterEach(() => {
  // Unmount before dropping the nodes: removing a container leaves its root
  // mounted, so effects and React-owned state would leak between tests.
  for (const root of roots) act(() => { root.unmount(); });
  roots.length = 0;
  document.body.replaceChildren();
});

describe("DashboardView — the Earnings Quality tile", () => {
  it("shows the measured composite, not the parser-fidelity score", async () => {
    const eq = tileText(await mountOpen(withCard(4, 84)), "Earnings Quality");

    expect(eq).toContain("84/100");
    expect(eq).toContain("4 of 4 dimensions measured");
    // What it used to show: 96 / 100 rendered through `format="pct"`.
    expect(eq).not.toContain("96.0%");
    expect(eq).not.toContain(`${FIDELITY}`);
  });

  it("leaves the fidelity score where it belongs, under its own name", async () => {
    // The fix must not have removed the number, only stopped a second tile
    // labelling it as something else — a reviewer still needs to see how much of
    // the file mapped, and this is the panel that says so.
    const container = await mountOpen(withCard(4, 84));

    expect(container.textContent).toContain("Parser Fidelity");
    expect(container.textContent).toContain(`${FIDELITY}% of labels mapped`);
  });

  it("shows no composite when every dimension was a placeholder", async () => {
    // An all-null card still totals 51/100 and calls itself "moderate". That is
    // the number the tile would print if it read the card instead of the summary.
    const eq = tileText(await mountOpen(withCard(0, 51)), "Earnings Quality");

    expect(eq).not.toContain("51");
    expect(eq).toContain("No dimension had inputs");
  });

  it("says no scorecard was built rather than reporting no inputs", async () => {
    // The structural-only envelope, and the shape a real one takes: the field is
    // null, not an absent-summary object. The rungs below valuation clear without
    // a scorecard, so this state ships, and it is a different fact from a
    // scorecard that ran and found nothing — one sends the reviewer to the run,
    // the other to the statements.
    const eq = tileText(await mountOpen(mkEnvelope(null)), "Earnings Quality");

    expect(eq).toContain("No scorecard for this run");
    expect(eq).not.toContain("No dimension had inputs");
    expect(eq).not.toContain(`${FIDELITY}`);
  });

  it("gives the same answer for a summary projected from no card", async () => {
    // The other way a scorecard can be absent. Not produced by today's builders —
    // both guard with `commandCenter ? buildEarningsQualitySummary(...) : null` —
    // but it is what the public projection returns, and the two must not read as
    // two different explanations of one fact.
    const eq = tileText(
      await mountOpen(mkEnvelope(buildEarningsQualitySummary(null))),
      "Earnings Quality",
    );

    expect(eq).toContain("No scorecard for this run");
    expect(eq).not.toContain("No dimension had inputs");
  });

  it("renders the tile with no envelope at all, and claims nothing", async () => {
    const eq = tileText(await mountOpen(null), "Earnings Quality");

    expect(eq).toContain("No scorecard for this run");
    expect(eq).toContain("—");
  });

  it("never says a valuation did not run while displaying one", async () => {
    // This surface builds its own command center, so it prints an intrinsic value
    // regardless of the envelope the tile reads. Wording the blank as "no
    // valuation ran" would put that sentence next to ₹7.
    const container = await mountOpen(mkEnvelope(null));

    expect(tileText(container, "Intrinsic Value")).toMatch(/₹/);
    expect(tileText(container, "Earnings Quality")).not.toContain("valuation");
  });
});
