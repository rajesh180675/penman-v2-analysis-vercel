/** @vitest-environment jsdom (downloadBlob drives browser download APIs) */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_DOCUMENT_SCHEMA_VERSION,
  assertReportArtifact,
  buildReportDocument,
  buildReportFilename,
  downloadBlob,
  renderReportDocumentHtml,
  renderReportDocumentPdf,
  sanitizeDownloadFilename,
  type DownloadEnvironment,
} from "../index";

function reportSurface(): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = `
    <h1>Investor Research Memorandum</h1>
    <p>A &amp; B &lt;script&gt;alert(1)&lt;/script&gt;</p>
    <ul><li>First conclusion</li><li>Second conclusion</li></ul>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody><tr><td>Residual income</td><td>125</td></tr></tbody>
    </table>
    <button>Do not export this control</button>
    <div class="no-print">Do not export this private surface</div>
    <h2 class="print-page-break">Valuation</h2>
  `;
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("report document", () => {
  it("extracts bounded semantic content while excluding controls and hidden surfaces", () => {
    const report = buildReportDocument(reportSurface(), {
      companyId: "TCS",
      latestPeriod: "2026-03-31",
      generatedAt: "2026-07-14T10:00:00.000Z",
      runId: "run-123",
      reproducibilityHash: "sha256:abc",
      rigorLabel: "production-ready",
      confidenceStatus: "high",
      valuationStatus: "eligible",
    });

    expect(report.schemaVersion).toBe(REPORT_DOCUMENT_SCHEMA_VERSION);
    expect(report.title).toBe("Investor Research Memorandum");
    expect(report.runIdentity).toEqual({ runId: "run-123", reproducibilityHash: "sha256:abc" });
    expect(report.trust).toEqual({
      rigorLabel: "production-ready",
      confidenceStatus: "high",
      valuationStatus: "eligible",
    });
    expect(report.blocks).toEqual(expect.arrayContaining([
      { kind: "paragraph", text: "- First conclusion" },
      { kind: "paragraph", text: "- Second conclusion" },
      { kind: "table", rows: [["Metric", "Value"], ["Residual income", "125"]] },
      { kind: "page-break" },
      { kind: "heading", level: 2, text: "Valuation" },
    ]));
    expect(JSON.stringify(report)).not.toContain("Do not export");
  });

  it("renders a self-contained escaped HTML representation without duplicating the title", () => {
    const report = buildReportDocument(reportSurface(), {
      companyId: "TCS",
      latestPeriod: "2026-03-31",
      generatedAt: "2026-07-14T10:00:00.000Z",
    });
    const html = renderReportDocumentHtml(report);

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("A &amp; B &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/<h1>Investor Research Memorandum<\/h1>/g)).toHaveLength(1);
    expect(html).not.toContain("<script>");
    expect(html).toContain("<th>Metric</th>");
  });
});

describe("artifact delivery", () => {
  it("builds safe, stable filenames and preserves a valid extension", () => {
    expect(buildReportFilename("TCS Ltd/India", "2026/03/31", "academic-report", "pdf"))
      .toBe("penman-TCS-Ltd-India-academic-report-2026-03-31.pdf");
    expect(sanitizeDownloadFilename("../../unsafe report.PDF"))
      .toBe("unsafe-report.pdf");
    expect(sanitizeDownloadFilename(`${"x".repeat(200)}.xlsx`).endsWith(".xlsx")).toBe(true);
  });

  it("keeps the object URL alive until the delayed revocation callback", () => {
    const revoke = vi.fn();
    const schedule = vi.fn<(callback: () => void, delayMs: number) => unknown>();
    const environment: DownloadEnvironment = {
      document,
      url: {
        createObjectURL: vi.fn(() => "blob:penman-report"),
        revokeObjectURL: revoke,
      },
      schedule,
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const result = downloadBlob(new Blob(["report"]), "../TCS Report.PDF", {
      environment,
      revokeDelayMs: 10,
    });

    expect(result).toEqual({ filename: "TCS-Report.pdf", bytes: 6 });
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledOnce();
    const [callback, delayMs] = schedule.mock.calls[0] ?? [];
    expect(delayMs).toBe(1_000);
    callback?.();
    expect(revoke).toHaveBeenCalledWith("blob:penman-report");
    expect(document.querySelector('a[download="TCS-Report.pdf"]')).toBeNull();
  });

  it("rejects malformed artifacts before delivery", async () => {
    await expect(assertReportArtifact(new Blob(["not a pdf"]), "pdf"))
      .rejects.toThrow("unexpectedly small");
    await expect(assertReportArtifact(new Blob([new Uint8Array(30)]), "xlsx"))
      .rejects.toThrow("valid ZIP/PK container");
  });

  it("generates a searchable PDF container from the semantic document", async () => {
    const report = buildReportDocument(reportSurface(), {
      companyId: "TCS",
      latestPeriod: "2026-03-31",
      generatedAt: "2026-07-14T10:00:00.000Z",
      rigorLabel: "valuation-eligible",
    });
    const pdf = await renderReportDocumentPdf(report);

    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(500);
    await expect(assertReportArtifact(pdf, "pdf")).resolves.toBeUndefined();
  }, 20_000);
});
