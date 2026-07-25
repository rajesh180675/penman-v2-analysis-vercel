export const REPORT_DOCUMENT_SCHEMA_VERSION = "2026-07-report-document-v1" as const;

const MAX_BLOCKS = 2_500;
const MAX_TEXT_CHARACTERS = 12_000;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 20;

export interface ReportDocumentMetadata {
  readonly companyId: string;
  readonly latestPeriod: string;
  readonly generatedAt?: string | undefined;
  readonly runId?: string | null | undefined;
  readonly reproducibilityHash?: string | null | undefined;
  readonly rigorLabel?: string | null | undefined;
  readonly confidenceStatus?: string | null | undefined;
  readonly valuationStatus?: string | null | undefined;
}

export interface ReportHeadingBlock {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4;
  readonly text: string;
}

export interface ReportParagraphBlock {
  readonly kind: "paragraph";
  readonly text: string;
}

export interface ReportTableBlock {
  readonly kind: "table";
  readonly rows: readonly (readonly string[])[];
}

export interface ReportPageBreakBlock {
  readonly kind: "page-break";
}

export type ReportBlock =
  | ReportHeadingBlock
  | ReportParagraphBlock
  | ReportTableBlock
  | ReportPageBreakBlock;

export interface ReportDocumentV1 {
  readonly schemaVersion: typeof REPORT_DOCUMENT_SCHEMA_VERSION;
  readonly title: string;
  readonly companyId: string;
  readonly latestPeriod: string;
  readonly generatedAt: string;
  readonly sourceSurface: "academic-report";
  readonly runIdentity: {
    readonly runId: string | null;
    readonly reproducibilityHash: string | null;
  };
  readonly trust: {
    readonly rigorLabel: string | null;
    readonly confidenceStatus: string | null;
    readonly valuationStatus: string | null;
  };
  readonly blocks: readonly ReportBlock[];
  readonly warnings: readonly string[];
}

function normalizeText(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARACTERS);
}

function isIgnoredElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "button", "input", "select", "textarea", "canvas", "svg", "noscript"].includes(tag)) {
    return true;
  }
  return element.hasAttribute("data-report-export-exclude")
    || element.getAttribute("aria-hidden") === "true"
    || element.classList.contains("no-print");
}

function tableRows(table: HTMLTableElement): readonly (readonly string[])[] {
  return Array.from(table.rows)
    .slice(0, MAX_TABLE_ROWS)
    .map((row) =>
      Array.from(row.cells)
        .slice(0, MAX_TABLE_COLUMNS)
        .map((cell) => normalizeText(cell.textContent)),
    )
    .filter((row) => row.some(Boolean));
}

function isSemanticContainer(element: Element): boolean {
  return ["div", "section", "article", "aside", "figure", "figcaption", "dl", "dt", "dd"].includes(
    element.tagName.toLowerCase(),
  );
}

function hasBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => {
    const tag = child.tagName.toLowerCase();
    return ["div", "section", "article", "aside", "figure", "h1", "h2", "h3", "h4", "p", "table", "ul", "ol", "dl"].includes(tag);
  });
}

export function buildReportDocument(
  reportElement: HTMLElement,
  metadata: ReportDocumentMetadata,
): ReportDocumentV1 {
  const blocks: ReportBlock[] = [];
  const warnings: string[] = [];
  let truncated = false;

  const push = (block: ReportBlock) => {
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true;
      return;
    }
    const previous = blocks[blocks.length - 1];
    if (
      block.kind === "paragraph"
      && previous?.kind === "paragraph"
      && previous.text === block.text
    ) {
      return;
    }
    blocks.push(block);
  };

  const walk = (element: Element) => {
    if (truncated || isIgnoredElement(element)) return;

    if (element.classList.contains("print-page-break")) {
      push({ kind: "page-break" });
    }

    const tag = element.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      const text = normalizeText(element.textContent);
      if (text) push({ kind: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4, text });
      return;
    }

    if (tag === "table") {
      const rows = tableRows(element as HTMLTableElement);
      if (rows.length) push({ kind: "table", rows });
      return;
    }

    if (tag === "p") {
      const text = normalizeText(element.textContent);
      if (text) push({ kind: "paragraph", text });
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      Array.from(element.children).forEach((item, index) => {
        if (item.tagName.toLowerCase() !== "li") return;
        const text = normalizeText(item.textContent);
        if (text) push({ kind: "paragraph", text: `${ordered ? `${index + 1}.` : "-"} ${text}` });
      });
      return;
    }

    if (isSemanticContainer(element) && !hasBlockChildren(element)) {
      const text = normalizeText(element.textContent);
      if (text) push({ kind: "paragraph", text });
      return;
    }

    Array.from(element.children).forEach(walk);
  };

  walk(reportElement);
  if (truncated) warnings.push(`Report content exceeded the ${MAX_BLOCKS}-block export limit and was truncated.`);
  if (!blocks.length) warnings.push("The report surface contained no exportable semantic blocks.");

  const firstHeading = blocks.find((block): block is ReportHeadingBlock => block.kind === "heading");
  return Object.freeze({
    schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
    title: firstHeading?.text ?? "Investor Research Memorandum",
    companyId: normalizeText(metadata.companyId) || "Unknown company",
    latestPeriod: normalizeText(metadata.latestPeriod) || "latest",
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    sourceSurface: "academic-report",
    runIdentity: Object.freeze({
      runId: metadata.runId?.trim() || null,
      reproducibilityHash: metadata.reproducibilityHash?.trim() || null,
    }),
    trust: Object.freeze({
      rigorLabel: metadata.rigorLabel?.trim() || null,
      confidenceStatus: metadata.confidenceStatus?.trim() || null,
      valuationStatus: metadata.valuationStatus?.trim() || null,
    }),
    blocks: Object.freeze(blocks),
    warnings: Object.freeze(warnings),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderReportDocumentHtml(document: ReportDocumentV1): string {
  const trust = [
    document.trust.rigorLabel ? `Rigor: ${document.trust.rigorLabel}` : null,
    document.trust.confidenceStatus ? `Confidence: ${document.trust.confidenceStatus}` : null,
    document.trust.valuationStatus ? `Valuation: ${document.trust.valuationStatus}` : null,
  ].filter((item): item is string => item !== null);

  const body = document.blocks.map((block, blockIndex) => {
    if (blockIndex === 0 && block.kind === "heading" && block.text === document.title) return "";
    if (block.kind === "page-break") return '<div class="page-break" aria-hidden="true"></div>';
    if (block.kind === "heading") return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    if (block.kind === "paragraph") return `<p>${escapeHtml(block.text)}</p>`;
    return `<table><tbody>${block.rows.map((row, rowIndex) =>
      `<tr>${row.map((cell) => rowIndex === 0
        ? `<th>${escapeHtml(cell)}</th>`
        : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>${escapeHtml(document.title)} - ${escapeHtml(document.companyId)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #1e293b; }
    body { max-width: 900px; margin: 0 auto; padding: 32px; line-height: 1.5; }
    header { border-bottom: 2px solid #334155; margin-bottom: 24px; padding-bottom: 16px; }
    .meta { color: #475569; font-size: 0.875rem; }
    h1, h2, h3, h4 { color: #0f172a; break-after: avoid; }
    h2 { margin-top: 28px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    p { white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 0.82rem; }
    th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #e2e8f0; }
    .page-break { break-before: page; }
    footer { margin-top: 32px; border-top: 1px solid #cbd5e1; padding-top: 12px; color: #64748b; font-size: 0.75rem; }
    @media print { body { padding: 0; } @page { size: A4; margin: 16mm; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(document.title)}</h1>
    <div class="meta">${escapeHtml(document.companyId)} | ${escapeHtml(document.latestPeriod)} | ${escapeHtml(document.generatedAt)}</div>
    ${trust.length ? `<div class="meta">${escapeHtml(trust.join(" | "))}</div>` : ""}
  </header>
  <main>${body}</main>
  <footer>Schema ${escapeHtml(document.schemaVersion)}${document.runIdentity.runId ? ` | Run ${escapeHtml(document.runIdentity.runId)}` : ""}</footer>
</body>
</html>`;
}
