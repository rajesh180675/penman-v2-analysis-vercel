import type { ReportDocumentV1, ReportTableBlock } from "./reportDocument";
import { assertReportArtifact } from "./artifactDelivery";

const PAGE_WIDTH_MM = 210;
const MARGIN_X_MM = 15;
const HEADER_Y_MM = 10;
const CONTENT_TOP_MM = 22;
const CONTENT_BOTTOM_MM = 279;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_X_MM * 2;

function pdfSafeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/₹/g, "INR ")
    .replace(/×/g, "x")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
}

export async function renderReportDocumentPdf(document: ReportDocumentV1): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: `${document.title} - ${document.companyId}`,
    subject: `Penman V2 analysis report for ${document.companyId}`,
    author: "Penman V2 Analysis",
    creator: document.schemaVersion,
    keywords: `valuation, ${document.companyId}, ${document.latestPeriod}`,
  });

  let y = CONTENT_TOP_MM;

  const drawHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(30, 41, 59);
    pdf.text(pdfSafeText(document.companyId), MARGIN_X_MM, HEADER_Y_MM);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100, 116, 139);
    pdf.text(pdfSafeText(document.latestPeriod), PAGE_WIDTH_MM - MARGIN_X_MM, HEADER_Y_MM, { align: "right" });
    pdf.setDrawColor(203, 213, 225);
    pdf.line(MARGIN_X_MM, 13, PAGE_WIDTH_MM - MARGIN_X_MM, 13);
  };

  const newPage = () => {
    pdf.addPage();
    drawHeader();
    y = CONTENT_TOP_MM;
  };

  const ensureRoom = (heightMm: number) => {
    if (y + heightMm > CONTENT_BOTTOM_MM) newPage();
  };

  const renderParagraph = (text: string, options: { size?: number; bold?: boolean; gap?: number } = {}) => {
    const size = options.size ?? 8.5;
    const lineHeight = size * 0.45;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(30, 41, 59);
    const lines = pdf.splitTextToSize(pdfSafeText(text), CONTENT_WIDTH_MM) as string[];
    let offset = 0;
    while (offset < lines.length) {
      if (y + lineHeight > CONTENT_BOTTOM_MM) newPage();
      const availableLines = Math.max(1, Math.floor((CONTENT_BOTTOM_MM - y) / lineHeight));
      const part = lines.slice(offset, offset + availableLines);
      pdf.text(part, MARGIN_X_MM, y, { baseline: "top" });
      y += part.length * lineHeight;
      offset += part.length;
      if (offset < lines.length) newPage();
    }
    y += options.gap ?? 2;
  };

  const renderWideTable = (table: ReportTableBlock) => {
    const header = table.rows[0] ?? [];
    table.rows.forEach((row, rowIndex) => {
      const text = row.map((cell, index) => `${header[index] || `Column ${index + 1}`}: ${cell}`).join(" | ");
      renderParagraph(text, { size: rowIndex === 0 ? 7.5 : 7, bold: rowIndex === 0, gap: 1.2 });
    });
  };

  const renderGridTable = (table: ReportTableBlock) => {
    const columnCount = Math.max(1, ...table.rows.map((row) => row.length));
    if (columnCount > 6) {
      renderWideTable(table);
      return;
    }
    const columnWidth = CONTENT_WIDTH_MM / columnCount;
    const fontSize = columnCount >= 5 ? 6.2 : 7.2;
    const lineHeight = fontSize * 0.43;
    const prepareRow = (row: readonly string[]) => {
      const cells = Array.from({ length: columnCount }, (_, index) =>
        (pdf.splitTextToSize(pdfSafeText(row[index] ?? ""), columnWidth - 2) as string[]).slice(0, 18),
      );
      return { cells, height: Math.max(5, ...cells.map((lines) => lines.length * lineHeight + 2)) };
    };
    const drawRow = (prepared: ReturnType<typeof prepareRow>, header: boolean) => {
      if (header) {
        pdf.setFillColor(226, 232, 240);
        pdf.rect(MARGIN_X_MM, y, CONTENT_WIDTH_MM, prepared.height, "F");
      }
      pdf.setDrawColor(203, 213, 225);
      pdf.setFont("helvetica", header ? "bold" : "normal");
      pdf.setFontSize(fontSize);
      pdf.setTextColor(30, 41, 59);
      prepared.cells.forEach((lines, index) => {
        const x = MARGIN_X_MM + index * columnWidth;
        pdf.rect(x, y, columnWidth, prepared.height);
        pdf.text(lines, x + 1, y + 1.2, { baseline: "top" });
      });
      y += prepared.height;
    };

    const header = table.rows[0] ? prepareRow(table.rows[0]) : null;
    if (header) {
      ensureRoom(header.height);
      drawRow(header, true);
    }
    table.rows.slice(1).forEach((row) => {
      const prepared = prepareRow(row);
      if (y + prepared.height > CONTENT_BOTTOM_MM) {
        newPage();
        if (header) drawRow(header, true);
      }
      drawRow(prepared, false);
    });
    y += 3;
  };

  drawHeader();
  renderParagraph(document.title, { size: 16, bold: true, gap: 2 });
  renderParagraph(`${document.companyId} | ${document.latestPeriod} | Generated ${document.generatedAt}`, { size: 8, gap: 1 });
  const trust = [
    document.trust.rigorLabel ? `Rigor: ${document.trust.rigorLabel}` : null,
    document.trust.confidenceStatus ? `Confidence: ${document.trust.confidenceStatus}` : null,
    document.trust.valuationStatus ? `Valuation: ${document.trust.valuationStatus}` : null,
  ].filter((item): item is string => item !== null);
  if (trust.length) renderParagraph(trust.join(" | "), { size: 8, bold: true, gap: 3 });

  for (const [blockIndex, block] of document.blocks.entries()) {
    if (blockIndex === 0 && block.kind === "heading" && block.text === document.title) continue;
    if (block.kind === "page-break") {
      if (y > CONTENT_TOP_MM + 4) newPage();
      continue;
    }
    if (block.kind === "heading") {
      const size = block.level === 1 ? 14 : block.level === 2 ? 11.5 : block.level === 3 ? 10 : 9;
      ensureRoom(size * 0.9 + 4);
      renderParagraph(block.text, { size, bold: true, gap: block.level <= 2 ? 3 : 2 });
      continue;
    }
    if (block.kind === "paragraph") {
      renderParagraph(block.text);
      continue;
    }
    renderGridTable(block);
  }

  const pageCount = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.setPage(pageNumber);
    pdf.setDrawColor(203, 213, 225);
    pdf.line(MARGIN_X_MM, 285, PAGE_WIDTH_MM - MARGIN_X_MM, 285);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(pdfSafeText(document.schemaVersion), MARGIN_X_MM, 290);
    pdf.text(`${pageNumber} / ${pageCount}`, PAGE_WIDTH_MM - MARGIN_X_MM, 290, { align: "right" });
  }

  const blob = pdf.output("blob");
  await assertReportArtifact(blob, "pdf");
  return blob;
}
