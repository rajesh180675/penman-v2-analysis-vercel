import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { isNextUiRequested } from "../../App";
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

describe("?ui=next switch", () => {
  it("mounts the next UI only when asked", () => {
    expect(isNextUiRequested("?ui=next")).toBe(true);
    expect(isNextUiRequested("?company=ITC&ui=next")).toBe(true);
    expect(isNextUiRequested("")).toBe(false);
    expect(isNextUiRequested("?ui=legacy")).toBe(false);
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

  it("marks the active section and says which phase builds it", () => {
    const html = renderToStaticMarkup(<CasePage route={caseRoute("ITC", "valuation")} company={itc} run={null} />);
    expect(html).toMatch(/aria-current="page"[^>]*>Valuation</);
    expect(html).toContain("Valuation arrives in Phase 3");
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
