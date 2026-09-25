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

  it("handles a ticker that is not in the library", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("NOPE")} company={null} run={null} />);
    expect(html).toContain("No company &quot;NOPE&quot; in the library");
  });
});
