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

  it("withholds the comparison, with the reason, for a company outside the ledger", () => {
    expect(text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={ledger} ticker="TCS" />)))
      .toContain("The as-filed ledger covers 1 company; this company's filings have not been fetched yet.");
    expect(text(renderToStaticMarkup(<EvidenceSection result={result} tieOut={null} ticker="ITC" />)))
      .toContain("The as-filed ledger is not available.");
  });

  it("serves the browser exactly the ledger scripts/filings/tie-out.ts wrote", () => {
    const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
    expect(read("public", "data", "filings", "tie-out.json")).toBe(read("data", "filings", "tie-out.json"));
  });
});
