import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { TieOutCompany } from "../hooks";
import { EvidenceSection } from "../sections/EvidenceSection";

const result = {
  status: "completed",
  run: {
    trustEnvelope: {
      rigor: { currentLabel: "Syntactically valid", summary: "", checkpoints: [] },
      reconciliation: { status: "confirmed", summary: "", checks: [] },
      parserFidelity: { status: "confirmed", score: 100, summary: "", checks: [] },
    },
  },
} as unknown as LegacyAnalysisRunExecutionResult;

const ledger: TieOutCompany[] = [{
  symbol: "ITC",
  firstFiling: "2018-05-17T15:20",
  rows: [
    { fiscalYearEnd: "2023-03-31", field: "totalAssets", asFiled: 90000, capitaline: 90000, relativeDifference: 0, status: "match" },
    { fiscalYearEnd: "2022-03-31", field: "revenue", asFiled: 65000, capitaline: 59000, relativeDifference: -0.0923, status: "mismatch" },
    { fiscalYearEnd: "2023-03-31", field: "revenue", asFiled: 76000, capitaline: 71000, relativeDifference: -0.0658, status: "mismatch" },
  ],
}];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Evidence — Capitaline vs as filed", () => {
  it("shows the company's comparisons, mismatches first and largest first, with the counts", () => {
    const html = text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={ledger} ticker="ITC" />));
    expect(html).toContain("3 comparisons: 1 match, 0 minor, 2 mismatch, 0 filing inconsistent.");
    expect(html).toContain("First filing 2018-05-17.");
    // −9.2% before −6.6% before the match.
    expect(html.indexOf("-9.2%")).toBeLessThan(html.indexOf("-6.6%"));
    expect(html.indexOf("-6.6%")).toBeLessThan(html.indexOf("0.0%"));
    expect(html).toContain("65,000");
  });

  it("says when a filed revenue was netted of the excise duty its filing itemizes", () => {
    const netted: TieOutCompany[] = [{
      symbol: "ITC",
      firstFiling: "2018-05-17T15:20",
      rows: [{ fiscalYearEnd: "2018-03-31", field: "revenue", asFiled: 43448.94, capitaline: 43449, relativeDifference: 0, status: "match", netOf: { label: "excise duty", value: 4239.61 } }],
    }];
    const html = text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={netted} ticker="ITC" />));
    expect(html).toContain("net of excise duty 4,240");
    expect(html).toContain("Revenue is compared net of the excise duty a filing itemizes");
  });

  it("withholds the comparison, with the reason, for a company outside the ledger", () => {
    // A financial's filings are on file for its share count, not compared: it is not counted.
    const withBank = [...ledger, { symbol: "HDFCBANK", firstFiling: "2019-04-20T10:00", rows: [] }];
    expect(text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={withBank} ticker="TCS" />)))
      .toContain("The as-filed ledger compares 1 company; this company's filings have not been fetched yet.");
    expect(text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={withBank} ticker="HDFCBANK" />)))
      .toContain("This company's filings are on file for its share count. They are not compared: the comparison is with the industrial recast, which does not describe a bank, NBFC or insurer.");
    expect(text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={null} ticker="ITC" />)))
      .toContain("The as-filed ledger is not available.");
  });

  it("serves the browser exactly the ledger scripts/filings/tie-out.ts wrote", () => {
    const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
    expect(read("public", "data", "filings", "tie-out.json")).toBe(read("data", "filings", "tie-out.json"));
  });
});
