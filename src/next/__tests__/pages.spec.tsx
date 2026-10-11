import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { selectInterface } from "../../App";
import { CasePage } from "../CasePage";
import { LibraryPage } from "../LibraryPage";
import { caseRoute } from "../route";

const itc: LibraryCompany = {
  folder: "ITC", name: "ITC Ltd", ticker: "ITC", sector: "FMCG", type: "consumer", description: "", emoji: "",
};
const tcs: LibraryCompany = { ...itc, folder: "TCS", name: "Tata Consultancy Services", ticker: "TCS", type: "it-services" };

function readyRun(): LegacyAnalysisRunExecutionResult {
  return {
    status: "completed",
    materialization: { commandCenter: null },
    run: {
      family: "industrial",
      trustEnvelope: {
        confidence: { status: "guarded", headline: "Guarded: reconciliation residuals exceed tolerance", tone: "amber" },
        rigor: { currentLabel: "Syntactically valid" },
      },
    },
  } as unknown as LegacyAnalysisRunExecutionResult;
}

describe("interface selection (Phase 6 cutover)", () => {
  it("defaults to the next UI and opens the classic interface on request", () => {
    expect(selectInterface("")).toBe("next");
    expect(selectInterface("?dark=1")).toBe("next");
    expect(selectInterface("?ui=next")).toBe("next");
    expect(selectInterface("?ui=classic")).toBe("classic");
  });

  it("keeps classic deep links landing in the classic interface", () => {
    expect(selectInterface("?company=TCS&tab=valuation")).toBe("classic");
    expect(selectInterface("?rf=7.00&erp=6.00&tab=upload&dark=0&company=TCS")).toBe("classic");
    expect(selectInterface("?tab=debug")).toBe("classic");
    // An explicit flag wins.
    expect(selectInterface("?ui=next&company=TCS")).toBe("next");
  });
});

describe("LibraryPage", () => {
  it("lists every company with its total and links each to its Case", () => {
    const html = renderToStaticMarkup(<LibraryPage registry={{ status: "ready", companies: [tcs, itc] }} />);
    expect(html).toContain("2 companies");
    expect(html).toContain('href="#/case/ITC/verdict"');
    expect(html).toContain('href="#/case/TCS/verdict"');
    // Sorted by name.
    expect(html.indexOf("ITC Ltd")).toBeLessThan(html.indexOf("Tata Consultancy Services"));
  });

  it("says so when the library cannot load", () => {
    const html = renderToStaticMarkup(<LibraryPage registry={{ status: "error", message: "Company registry unavailable (404)." }} />);
    expect(html).toContain("Company registry unavailable (404).");
  });
});

describe("CasePage", () => {
  it("shows the run's confidence and rigor level in the header", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={{ status: "ready", result: readyRun() }} />);
    expect(html).toContain("ITC Ltd");
    expect(html).toContain("Guarded: reconciliation residuals exceed tolerance");
    expect(html).toContain("Rigor: Syntactically valid");
  });

  it("names each section region once — the section is the landmark, not its cards", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={{ status: "ready", result: readyRun() }} />);
    expect(html.match(/aria-label="Verdict"/g)).toHaveLength(1);
  });

  it("marks the active section, and every section is built", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("ITC", "peers")} company={itc} run={null} />);
    expect(html).toMatch(/aria-current="page"[^>]*>Peers</);
    expect(html).not.toContain("arrives in Phase");
    expect(html).toContain('href="#/case/ITC/forecast"');
  });

  it("reports progress, then errors, without inventing a result", () => {
    expect(renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={{ status: "loading", step: "parsing" }} />))
      .toContain("Reading statements");
    expect(renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={{ status: "error", message: "Company data not found (404)." }} />))
      .toContain("Analysis could not run: Company data not found (404).");
  });

  // The library's Capitaline exports are refreshed by hand, so a case can run
  // a year behind what the company has filed (20 of 23 on 2026-10-11).
  it("says when the company has filed results newer than the data the case runs on", () => {
    const run = (through: string) => ({
      status: "ready" as const,
      result: { ...readyRun(), materialization: { commandCenter: null, rawData: [{ period_end: "2024-03-31" }, { period_end: through }] } } as unknown as LegacyAnalysisRunExecutionResult,
    });
    const ledger = [{ symbol: "ITC", firstFiling: "2018-06-08T15:27", rows: [], latestFiling: { fiscalYearEnd: "2026-03-31", filingDate: "2026-05-21T18:10" } }];
    const stale = renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={run("2025-03-31")} tieOut={ledger} />);
    expect(stale).toContain("Newer results are on file.");
    expect(stale).toContain("filed its results for the year to 2026-03-31 on NSE");
    expect(stale).toContain("on 2026-05-21");
    expect(stale).toContain("runs on Capitaline data to 2025-03-31");
    // ...and points to where the forecast is set against them.
    expect(stale).toContain('href="#/case/ITC/forecast" class="underline">See the forecast beside them</a>');
    // Current data, an as-of view (older on purpose), or no ledger: no note.
    expect(renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={run("2026-03-31")} tieOut={ledger} />)).not.toContain("Newer results");
    expect(renderToStaticMarkup(<CasePage route={{ ...caseRoute("ITC"), asOf: "2025-03-31" }} company={itc} run={run("2025-03-31")} tieOut={ledger} />)).not.toContain("Newer results");
    expect(renderToStaticMarkup(<CasePage route={caseRoute("ITC")} company={itc} run={run("2025-03-31")} tieOut={null} />)).not.toContain("Newer results");
  });

  it("handles a ticker that is not in the library", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("NOPE")} company={null} run={null} />);
    expect(html).toContain("No company &quot;NOPE&quot; in the library");
  });
});
