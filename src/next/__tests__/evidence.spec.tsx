import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { EvidenceSection } from "../sections/EvidenceSection";

function result(): LegacyAnalysisRunExecutionResult {
  return {
    status: "completed",
    run: {
      trustEnvelope: {
        rigor: {
          currentLabel: "Syntactically valid",
          summary: "Parser fidelity passed; reconciliation did not.",
          checkpoints: [
            { level: "syntactically-valid", label: "Syntactically valid", achieved: true, detail: "Data present." },
            { level: "structurally-reconciled", label: "Structurally reconciled", achieved: false, detail: "Balance-sheet residual 4.2%." },
          ],
        },
        reconciliation: {
          status: "failed",
          summary: "1 gating check failed.",
          checks: [
            { key: "bs", label: "Balance sheet", periodEnd: "2025-03-31", residual: 1, ratio: 0.001, status: "confirmed" },
            { key: "cash", label: "Cash bridge", periodEnd: "2025-03-31", residual: 9, ratio: 0.9, status: "failed", role: "diagnostic" },
            { key: "tci", label: "PAT + OCI − NCI share = TCI (owners)", periodEnd: "2024-03-31", residual: 5, ratio: 0.042, status: "failed" },
          ],
        },
        parserFidelity: {
          status: "confirmed", score: 96, summary: "All core lines mapped.",
          checks: [
            { id: "a", label: "Sales mapped", passed: true, detail: "Revenue From Operations(Net)" },
            { id: "b", label: "Finance income mapped", passed: false, detail: "Fell back to rung 4" },
          ],
        },
      },
    },
  } as unknown as LegacyAnalysisRunExecutionResult;
}

describe("EvidenceSection", () => {
  it("shows the rigor ladder with what was and was not achieved", () => {
    const html = renderToStaticMarkup(<EvidenceSection result={result()} />);
    expect(html).toContain("Reached: <strong>Syntactically valid</strong>");
    expect(html).toContain("Not achieved");
    expect(html).toContain("Balance-sheet residual 4.2%.");
  });

  it("lists reconciliation failures first, with the total and diagnostic checks marked", () => {
    const html = renderToStaticMarkup(<EvidenceSection result={result()} />);
    expect(html).toContain("2 of 3 checks not confirmed");
    // Failures before the confirmed check; the larger failure first.
    expect(html.indexOf("Cash bridge")).toBeLessThan(html.indexOf("PAT + OCI"));
    expect(html.indexOf("PAT + OCI")).toBeLessThan(html.indexOf("Balance sheet"));
    expect(html).toContain("(diagnostic)");
  });

  it("states parser failures with their totals", () => {
    const html = renderToStaticMarkup(<EvidenceSection result={result()} />);
    expect(html).toContain("1 of 2 checks failed");
    expect(html.indexOf("Finance income mapped")).toBeLessThan(html.indexOf("Sales mapped"));
  });

  it("withholds evidence when the run failed before producing any", () => {
    const failed = { status: "failed", run: null, message: "parse error" } as unknown as LegacyAnalysisRunExecutionResult;
    expect(renderToStaticMarkup(<EvidenceSection result={failed} />)).toContain("failed before producing evidence: parse error");
  });
});
