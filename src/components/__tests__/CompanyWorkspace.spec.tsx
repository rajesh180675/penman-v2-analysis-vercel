import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CompanyWorkspace from "../CompanyWorkspace";
import type { CompanyRegistry, EngineConfig, RawPeriodData } from "../../engine/types";
import { DEFAULT_CONFIG } from "../../engine/types";

function mkRaw(companyId: string, periodEnd: string): RawPeriodData {
  return {
    company_id: companyId,
    period_end: periodEnd,
    raw_metric_values: {
      Sales: 900,
      "Net Profit": 90,
      "Total Assets": 1000,
    },
  };
}

function renderWorkspace() {
  const rawData = [mkRaw("TESTCO", "2025-03-31")];
  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    sector_template: "industrials",
  };
  const registry: CompanyRegistry = { companies: {} };

  return renderToStaticMarkup(
    <CompanyWorkspace
      rawData={rawData}
      recastData={null}
      config={config}
      analysisStatus={null}
      auditMeta={null}
      registry={registry}
      selectedCompanyId={null}
    />,
  );
}

describe("CompanyWorkspace", () => {
  it("renders the workspace hero with the selected company id and template chip", () => {
    const html = renderWorkspace();
    expect(html).toContain("Company Workspace");
    expect(html).toContain("TESTCO");
    expect(html).toContain(
      "This is the investor operating system for the current codebase",
    );
    expect(html).toContain("Selected company");
    expect(html).toContain("template industrial");
  });

  it("renders the investor guidance default headline", () => {
    const html = renderWorkspace();
    expect(html).toContain("Investor Guidance");
    expect(html).toContain("Build understanding before building exposure");
  });

  it("renders the local and shared metric cards", () => {
    const html = renderWorkspace();
    expect(html).toContain("Saved runs");
    expect(html).toContain("Filing memory");
    expect(html).toContain("Signal history");
    expect(html).toContain("Latest signal");
    expect(html).toContain("Shared filings");
    expect(html).toContain("Shared valuations");
    expect(html).toContain("Shared analysis");
    expect(html).toContain("Shared notes");
    expect(html).toContain("Alerts");
  });

  it("renders the research workflow checklist", () => {
    const html = renderWorkspace();
    expect(html).toContain("Research Workflow");
    expect(html).toContain("Understand the business");
    expect(html).toContain("Write the thesis and variant view");
    expect(html).toContain("Check accounting confidence");
    expect(html).toContain("Anchor on the stress case");
    expect(html).toContain("Current watch level:");
  });

  it("renders the latest valuation memory empty state", () => {
    const html = renderWorkspace();
    expect(html).toContain("Latest Valuation Memory");
    expect(html).toContain(
      "No audited valuation memory exists for this company yet.",
    );
  });

  it("renders the research notebook field labels", () => {
    const html = renderWorkspace();
    expect(html).toContain("Research Notebook");
    expect(html).toContain("Business Summary");
    expect(html).toContain("Investment Thesis");
    expect(html).toContain("Variant View");
    expect(html).toContain("Key Drivers");
    expect(html).toContain("Catalysts");
    expect(html).toContain("Risks");
    expect(html).toContain("What Must Go Right");
    expect(html).toContain("What Breaks The Thesis");
    expect(html).toContain("Watch Level");
    expect(html).toContain("Position Plan");
    expect(html).toContain("Next Check");
    expect(html).toContain("Notebook updated:");
  });

  it("renders the diagnostics, ontology, and analysis-memory sections", () => {
    const html = renderWorkspace();
    expect(html).toContain("Concept Ontology Coverage");
    expect(html).toContain("Coverage");
    expect(html).toContain("Core matched");
    expect(html).toContain("Top unmapped");
    expect(html).toContain("Statement Diagnostics And Corporate Actions");
    expect(html).toContain("Internal Analysis Memory");
    expect(html).toContain("No local analysis memory for this company yet.");
  });

  it("renders the audited run history table headers and empty state", () => {
    const html = renderWorkspace();
    expect(html).toContain("Audited Run History");
    expect(html).toContain("Latest period");
    expect(html).toContain("Stress CAGR");
    expect(html).toContain("Health");
    expect(html).toContain("No remembered audited runs for this company yet.");
  });

  it("renders the empty-state card when no company options exist", () => {
    const html = renderToStaticMarkup(
      <CompanyWorkspace
        rawData={null}
        recastData={null}
        config={DEFAULT_CONFIG}
        analysisStatus={null}
        auditMeta={null}
        registry={{ companies: {} }}
        selectedCompanyId={null}
      />,
    );
    expect(html).toContain("No company workspace yet");
    expect(html).toContain("Load a company first.");
  });
});
