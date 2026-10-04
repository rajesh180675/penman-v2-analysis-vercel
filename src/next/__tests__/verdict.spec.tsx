import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { CompanyTrackRecord } from "../../engine/accountability";
import { VerdictSection } from "../sections/VerdictSection";

function card(key: "stress" | "base" | "bull", value: number | null, upside: number | null) {
  return { key, label: key[0]!.toUpperCase() + key.slice(1), intrinsicPerShare: value, upsidePct: upside };
}

function commandCenter(overrides: Record<string, unknown> = {}) {
  return {
    signal: { label: "Fairly valued", summary: "Base case sits near the price." },
    marketPrice: 1000,
    marketContext: { freshness: "live", latestReportedPeriod: "2025-03-31" },
    shareBasis: { shares: 100 },
    scenarios: [card("stress", 800, -0.2), card("base", 1100, 0.1), card("bull", 1400, 0.4)],
    opportunity: { expectedCagrStress: 0.052 },
    range: { floorPerShare: 750, ceilingPerShare: 1450 },
    anchorPeriod: { period_end: "2025-03-31" },
    valuationReadiness: { status: "production-ready", reasons: [] },
    ...overrides,
  };
}

function render(cc: unknown, run: Record<string, unknown> = { family: "industrial" }, status = "completed", trackRecord: CompanyTrackRecord | null = null) {
  const result = { status, run, materialization: { commandCenter: cc }, reasonCode: "SCOPE_BLOCKED", message: "boom" } as unknown as LegacyAnalysisRunExecutionResult;
  return renderToStaticMarkup(<VerdictSection result={result} trackRecord={trackRecord} />);
}

describe("VerdictSection", () => {
  it("shows the signal, the scenario values and the price on one range", () => {
    const html = render(commandCenter());
    expect(html).toContain("Fairly valued");
    expect(html).toContain("₹1100.00");
    expect(html).toContain("Upside 10.0%");
    expect(html).toContain("Price ₹1000.00");
    expect(html).toContain("5.2%");
  });

  it("withholds price, upside and CAGR — with the reason — when there is no market price", () => {
    const html = render(commandCenter({ marketPrice: null, marketContext: { freshness: "missing", latestReportedPeriod: "2025-03-31" }, opportunity: { expectedCagrStress: null } }));
    expect(html).toContain("No market price: the live market overlay is missing.");
    expect(html).not.toContain("Upside");
    expect(html).not.toContain("Price ₹");
  });

  it("states the forecast's track record as counts a reader can check", () => {
    const html = render(commandCenter(), undefined, undefined, {
      ticker: "TCS",
      oneYearAhead: {
        "sales-log-error": { scored: 10, beatRandomWalk: 5 },
        "core-oi-margin-error": { scored: 10, beatRandomWalk: 4 },
        "cni-roe-point-error": { scored: 10, beatRandomWalk: 3 },
      },
    });
    expect(html).toContain("sales in 5 of 10 years; operating margin in 4 of 10 years; earnings in 3 of 10 years");
  });

  it("withholds the track record when there is none", () => {
    expect(render(commandCenter())).toContain("No backtest record for this company.");
  });

  it("withholds the break-evens rather than showing a bare dash when the run has no base forecast", () => {
    const html = render(commandCenter());
    expect(html).toContain("What would change our mind");
    expect(html).toContain("The run has no base-case forecast.");
    expect(html).not.toMatch(/>—</);
  });

  it("withholds a per-share value when no share count resolved", () => {
    const html = render(commandCenter({ shareBasis: { shares: null }, scenarios: [card("stress", null, null), card("base", null, null), card("bull", null, null)] }));
    expect(html).toContain("No share count could be resolved");
    expect(html).not.toContain("₹1100.00");
  });

  it("says why an anchor is older than the latest report", () => {
    const html = render(commandCenter({
      anchorPeriod: { period_end: "2024-03-31" },
      valuationReadiness: { status: "guarded", reasons: ["Using prior anchor period 2024-03-31 because 2025-03-31 is compromised."] },
    }));
    expect(html).toContain("2024-03-31");
    expect(html).toContain("because 2025-03-31 is compromised");
  });

  it("withholds the whole verdict with a reason when the run has no industrial valuation", () => {
    expect(render(null, { family: "bank" })).toContain("financial-institution models");
    expect(render(null, { family: "industrial" }, "blocked")).toContain("blocked (SCOPE_BLOCKED)");
    expect(render(null, { family: "industrial" }, "failed")).toContain("The analysis failed: boom");
  });
});

describe("VerdictSection — a financial institution", () => {
  const fiResult = (achieved: boolean, detail: string, price: number | null) => ({
    status: achieved ? "completed" : "blocked",
    reasonCode: achieved ? undefined : "LEGACY_VALUATION_GATE_NOT_CLEARED",
    run: {
      family: "insurance",
      trustEnvelope: { rigor: { checkpoints: [{ level: "valuation-eligible", achieved, detail }] } },
    },
    materialization: {
      commandCenter: null,
      marketSnapshot: price == null ? null : { price },
      rawData: [{ company_id: "HDFCLIFE", period_end: "2025-03-31", raw_metric_values: {
        "Number of Equity Shares - Paid Up__BalanceSheet": 215.3,
        "Total Equity Capital(Ordinary)__BalanceSheet": 2153,
        "Face Value of Equity Shares__BalanceSheet": 10,
      } }],
      pipelineResult: {
        bankResult: {
          subtype: "insurance",
          valuation: { ke: 0.1296, evBased: { status: "computed", intrinsicValue: 102_967, premiumOverMarket: null, reason: "", diagnostics: {} } },
        },
      },
    },
  }) as unknown as LegacyAnalysisRunExecutionResult;

  it("shows the headline value per share against the price, with the rung's reason", () => {
    const html = renderToStaticMarkup(<VerdictSection result={fiResult(true, "Financial institution — Valuation-eligible on the filed embedded value and value of new business.", 700)} />);
    expect(html).toContain("Valuation-eligible");
    expect(html).toContain("Valuation-eligible on the filed embedded value and value of new business.");
    expect(html).toContain("Embedded value + value of new business");
    expect(html).toContain("₹1,02,967 Cr");
    expect(html).toContain("₹700.00");
    expect(html).toContain("215.30 crore");
  });

  it("says why it is not valuation-eligible and withholds the price-dependent figures", () => {
    const html = renderToStaticMarkup(<VerdictSection result={fiResult(false, "Valuation eligible was not achieved because LEGACY_VALUATION_GATE_NOT_CLEARED: Financial institution — One independent lens, book residual income.", null)} />);
    expect(html).toContain("Not valuation-eligible");
    expect(html).toContain("One independent lens, book residual income.");
    expect(html).not.toContain("LEGACY_VALUATION_GATE_NOT_CLEARED");
    expect(html).toContain("No market price");
  });
});
