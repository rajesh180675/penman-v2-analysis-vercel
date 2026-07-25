import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExportToolbar } from "../academic/ExportToolbar";

function renderToolbar(overrides: Partial<Parameters<typeof ExportToolbar>[0]> = {}) {
  return renderToStaticMarkup(<ExportToolbar
    hmacKeyId=""
    setHmacKeyId={vi.fn()}
    hmacSecret=""
    setHmacSecret={vi.fn()}
    exportWorkbook={vi.fn()}
    exportPdf={vi.fn()}
    exportIcBundle={vi.fn()}
    activeExport={null}
    notice={null}
    {...overrides}
  />);
}

describe("ExportToolbar", () => {
  it("prevents overlapping exports and identifies the active format", () => {
    const html = renderToolbar({
      activeExport: "pdf",
      notice: { tone: "success", message: "Previous artifact downloaded." },
    });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Generating PDF...");
    expect(html.match(/disabled=""/g)?.length).toBe(5);
    expect(html).toContain('role="status"');
    expect(html).toContain("Previous artifact downloaded.");
  });

  it("exposes export failures through an accessible alert", () => {
    const html = renderToolbar({
      notice: { tone: "error", message: "PDF export failed validation." },
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="report-export-status"');
    expect(html).toContain("PDF export failed validation.");
  });
});
