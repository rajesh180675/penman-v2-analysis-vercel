# Greenfield Reporting and Export Platform Design

**Date:** 2026-07-14  
**Role:** Principal Architecture  
**Scope:** Report tab, downloadable artifacts, audit persistence, and investment-committee bundle  
**Status:** Implemented and validated in the same task

## 1. Executive decision

The Report tab will no longer treat a screenshot of the live React DOM as the report.

The greenfield reporting platform introduces a versioned, renderer-neutral `ReportDocument` between the analytical publication snapshot and every downloadable artifact. PDF, HTML, JSON, workbook, and investment-committee bundle adapters must consume either that document or the same immutable publication snapshot. Browser delivery, artifact validation, audit persistence, status reporting, and failure semantics become shared infrastructure.

This design fixes the current failures while creating an architecture that can later support server-side rendering and signed publications without changing the analytical engine.

## 2. Current-state audit

### 2.1 PDF

The existing PDF path renders the complete Report-tab DOM into one high-resolution PNG using `html2canvas`, then repeatedly places different vertical offsets of that same image into jsPDF pages.

Observed structural defects:

- Tailwind CSS 4 emits `oklch`, `oklab`, and `color-mix`; `html2canvas` 1.4.1 cannot reliably parse the compiled stylesheet.
- One bitmap for the entire memo creates a large peak-memory allocation and can exceed browser canvas limits on long reports.
- Rasterized text is not searchable, selectable, accessible, or crisp when zoomed.
- Page breaks can cut rows, headings, and charts because pagination happens after rasterization.
- PDF generation has no format-level validity check before download.

### 2.2 Investment-committee ZIP

The ZIP calls the same PDF generator before assembling the other artifacts. A PDF rendering failure therefore prevents CSV, JSON, Markdown, and manifest artifacts from being delivered even when they are valid.

The ZIP has valuable checksum and optional HMAC controls, but it has no canonical report-document artifact or accessible HTML representation.

### 2.3 XLSX

The workbook generator is structurally stronger and already has read-back tests. Its browser-delivery path is duplicated, however, and shares the immediate object-URL revocation defect.

### 2.4 Browser delivery and UX

Every export creates an object URL, clicks a temporary anchor, removes it, and revokes the URL synchronously. Some browsers may cancel a download before consuming the URL.

Other cross-format gaps:

- no shared filename sanitation;
- no signature/magic-byte validation;
- no structured export result;
- no visible success or error message;
- rejected promises become console-only failures;
- PDF/ZIP/XLSX jobs can overlap;
- audit persistence and browser delivery are not reported separately.

## 3. Goals

1. Make PDF, XLSX, and IC ZIP exports work reliably in supported browsers.
2. Remove runtime dependence on DOM screenshot rendering.
3. Generate searchable, paginated PDF text and tables.
4. Make one canonical report document available to PDF and the IC bundle.
5. Validate each artifact before exposing it to the user.
6. Deliver every browser download through one delayed-revocation adapter.
7. Surface generation, download, and audit outcomes in the Report tab.
8. Preserve fail-closed analytical truth: export must never upgrade run confidence.
9. Preserve and extend checksum/HMAC evidence in the IC bundle.
10. Keep heavy renderer dependencies lazy-loaded behind an export action.

## 4. Non-goals and authority boundaries

- The reporting layer must not recompute or override authoritative valuation results.
- It must not manufacture reviewer approvals, signing keys, or external evidence.
- Browser HMAC remains a local tamper-evidence option, not an institutional signing service.
- A production signing service, timestamp authority, PDF/A conformance service, and remote headless renderer require external infrastructure and are not fabricated by repository code.
- Charts may be represented by their accessible labels and backing tables in the first vector renderer. A later chart renderer can add SVG/vector chart blocks without changing the document schema.

## 5. Target architecture

```text
AnalysisRun + AnalysisPublicationSnapshot
                    |
                    v
        ReportDocument schema v1
          |       |        |
          |       |        +--> JSON / accessible HTML
          |       +-----------> searchable vector PDF
          +-------------------> IC bundle inputs

AnalysisPublicationSnapshot ----> institutional XLSX

All generated artifacts
          |
          v
signature / size / MIME validation
          |
          v
shared browser download adapter
          |
          +--> delayed object-URL revocation
          +--> structured ExportResult
          +--> optional audit persistence
          +--> visible UI status
```

## 6. Canonical document contract

`ReportDocumentV1` contains:

- schema version;
- title, company, period, generation time, and immutable run identity;
- trust/rigor metadata;
- bounded ordered blocks;
- normalized headings;
- paragraphs and list items;
- tables with bounded rows and columns;
- explicit page-break markers;
- source surface and extraction warnings.

Supported block kinds:

- `heading`
- `paragraph`
- `table`
- `page-break`

The initial adapter extracts structured semantic content from the existing report element. It explicitly ignores scripts, styles, controls, canvases, and SVG implementation details. This is a migration bridge: the stable contract belongs to the reporting layer even while React remains the authoring surface.

Safety limits prevent a malformed DOM or source payload from creating unbounded memory use:

- maximum blocks;
- maximum characters per block;
- maximum table rows;
- maximum table columns;
- bounded file names and metadata.

## 7. PDF renderer

The v1 PDF renderer uses jsPDF directly:

- A4 portrait;
- vector text rather than one report-sized image;
- bounded margins;
- explicit header and footer;
- deterministic page-number pass;
- heading-aware pagination;
- wrapped paragraphs;
- row-aware tables;
- ASCII-safe normalization for the built-in Helvetica font;
- document metadata;
- `%PDF-` signature and minimum-size validation.

The renderer must never parse the application's CSS. Tailwind color-space changes therefore cannot break PDF generation.

## 8. Workbook adapter

The existing workbook generator remains authoritative because it already produces real worksheets and has ExcelJS read-back tests. The new export coordinator wraps it with:

- a company-scoped sanitized filename;
- non-empty and ZIP-signature validation (`PK`);
- the common download adapter;
- a structured result;
- visible error handling;
- audit outcome reporting.

Forecast sheets remain controlled by the publication input. An empty scenario list must be disclosed rather than silently represented as a forecast.

## 9. Investment-committee bundle

The bundle contains:

- searchable PDF generated from `ReportDocumentV1`;
- `report_document.json`;
- accessible standalone `report_document.html`;
- granularity checklist CSV and JSON;
- traceability appendix CSV and JSON;
- provenance report CSV and Markdown;
- `manifest.json`.

The manifest records:

- schema and generation time;
- company and period range;
- valuation readiness;
- policy versions and traceability;
- immutable run identity;
- row/block counts;
- MIME type, bytes, and SHA-256 for each file;
- manifest-payload SHA-256;
- optional HMAC-SHA256 signature and key identifier.

The final ZIP must be non-empty and begin with the ZIP `PK` signature before delivery.

## 10. Browser delivery contract

One `downloadBlob` adapter owns:

- non-empty blob validation;
- safe filename normalization;
- object-URL creation;
- temporary hidden anchor creation;
- click and cleanup;
- delayed URL revocation;
- dependency injection for deterministic tests.

The URL must not be revoked in the same task as the click. A 30-second default grace period covers browsers that consume the URL asynchronously.

## 11. Export coordination and user experience

The Report tab has one active export at a time.

State model:

```text
idle -> generating -> downloaded
                  -> failed
```

The toolbar must:

- disable all format buttons while one job is active;
- expose `aria-busy`;
- show format-specific progress text;
- show a persistent success notice with filename and size;
- show an accessible error alert with an actionable message;
- distinguish “downloaded but audit storage unavailable” from generation failure.

Errors are caught at the component boundary and recorded through the export trace category. A failed export must restore the toolbar to an operable state.

## 12. Audit and security

- Download generation is independent of optional audit persistence.
- A transient audit failure must not destroy an already generated user artifact.
- Content types are explicit.
- Filenames cannot contain path separators or control characters.
- HMAC secrets remain in component memory and are never placed in the manifest.
- The manifest includes only the key identifier and signature.
- HTML output escapes text and contains no executable script.
- The HTML artifact uses a restrictive embedded content-security policy.
- Trust, rigor, schema, and run identity are copied from publication state, never inferred from presentation.

## 13. Performance budget

- No full-report raster canvas.
- PDF rendering is proportional to semantic text/table content.
- PDF, ZIP, and workbook libraries remain dynamically imported.
- Export status updates occur before heavy work begins.
- The document extractor has hard bounds.
- Bundle checksums are computed once per artifact.

## 14. Test strategy

### Unit

- semantic extraction order and bounds;
- HTML escaping;
- filename sanitation;
- delayed object-URL revocation;
- PDF header and non-empty output;
- XLSX and ZIP magic-byte validation;
- ZIP manifest and file checksum closure;
- CSV escaping;
- UI success, error, and mutual-exclusion states.

### Existing focused regression

- `AcademicReport.spec.tsx`
- `excelExport.spec.ts`
- `bankExcelExport.spec.ts`

### Repository gates

- application and script type checks;
- focused reporting tests;
- production build;
- bundle budget;
- full `npm run validate`.

### Manual acceptance

For TCS and one financial institution:

1. Open Report.
2. Export PDF and confirm searchable text, multiple pages, correct company/period, and no blank/cut bitmap pages.
3. Export XLSX and open/read all expected worksheets.
4. Export IC ZIP, open the PDF/HTML/JSON, and verify manifest checksums.
5. Repeat in dark mode.
6. Simulate audit API unavailability and confirm the local download still completes with a warning.

## 15. Implementation phases

### Phase 1 - Foundation

- add `ReportDocumentV1`;
- add semantic extraction and accessible HTML rendering;
- add shared artifact validation and browser download adapter.

### Phase 2 - PDF replacement

- remove `html2canvas` from the report export path;
- add the vector/text PDF renderer;
- use the same canonical document for standalone PDF and bundle PDF.

### Phase 3 - Format consolidation

- wrap XLSX with validation and shared delivery;
- add canonical JSON/HTML to the IC bundle;
- validate ZIP closure and retain checksum/HMAC governance.

### Phase 4 - UX and observability

- add one-job coordination;
- add accessible progress, success, warning, and error notices;
- trace export lifecycle and outcomes.

### Phase 5 - Verification

- add unit and component regressions;
- run focused Excel/report tests;
- run typecheck, build, and full validation.

### Phase 6 - Operational handoff

- update this document with implementation evidence;
- document external future capabilities separately from completed repository work.

## 16. Acceptance criteria

The repository implementation is complete when:

- PDF generation has no `html2canvas` dependency;
- standalone PDF and bundle PDF come from the same versioned document;
- PDF, XLSX, and ZIP have signature validation;
- all formats use the shared download adapter;
- object URLs are revoked after a grace period;
- users see success or actionable failure status;
- only one export runs at a time;
- IC ZIP contains PDF, HTML, JSON, evidence appendices, and a closed manifest;
- focused tests, typecheck, production build, and full validation pass;
- no analytical confidence or provenance contract is weakened.

## 17. Future external evolution

After repository implementation, production owners may add:

- server-side PDF/A-3 generation;
- organization-branded templates;
- qualified digital signatures and trusted timestamps;
- durable publication URLs with access control;
- translation/localization packs;
- vector chart blocks;
- WCAG/PDF-UA validation;
- scheduled publication jobs;
- reviewer redline and approval workflow;
- long-term records-management policy.

These are additive adapters and services around `ReportDocument`, not reasons to return to DOM screenshots.

## 18. Implementation record

### 18.1 Delivered repository capabilities

Implementation completed on 2026-07-14:

- `src/reporting/reportDocument.ts` defines the versioned `2026-07-report-document-v1` contract, bounded semantic extraction, and escaped standalone HTML renderer.
- `src/reporting/pdfRenderer.ts` produces paginated A4 vector/text PDFs with headers, footers, metadata, table handling, and format validation.
- `src/reporting/artifactDelivery.ts` centralizes filename safety, PDF/ZIP/XLSX signature checks, structured receipts, and delayed object-URL revocation.
- `src/components/academic/AcademicReport.exports.ts` routes standalone PDF, institutional XLSX, and IC ZIP through the shared contracts and preserves optional audit persistence.
- The IC bundle now contains the canonical report JSON, standalone HTML, searchable PDF, checklist, traceability, provenance, and a checksum-closed manifest with optional HMAC.
- `src/components/AcademicReport.tsx` coordinates one export at a time, traces lifecycle events, restores state after failure, and distinguishes local-download success from audit-storage failure.
- `src/components/academic/ExportToolbar.tsx` exposes busy state plus accessible progress, success, warning, and error feedback.
- The direct `html2canvas` dependency and all DOM screenshot calls were removed. A Vite fail-closed alias replaces jsPDF's unused optional DOM-raster module with a 0.13 KB gzip guard instead of shipping the 47.43 KB gzip raster chunk.

### 18.2 Automated verification evidence

- Reporting-focused regression: 5 files and 25 tests passed.
- IC ZIP read-back verifies required entries, PDF header, schema pin, unsigned signature mode, and exact manifest checksum closure.
- Application TypeScript check passed.
- Scripts/server TypeScript check passed.
- `npm run validate` passed in 897.4 seconds:
  - application and scripts type checks;
  - `any` budget, traceability schema pin, Vercel function budget, and model-catalog checks;
  - real audit-snapshot transport integration: 1 file and 1 test passed;
  - sharded suite: 249 files and 2,040 tests passed, 1 file and 9 tests skipped by policy;
  - 33-company registry validation;
  - production Vite build;
  - bundle budget.
- After adding the final raster-module packaging guard, focused tests, application/scripts type checks, production build, and bundle budget were rerun and passed.
- Final production bundle: 72 JavaScript chunks, 1,399.6 KB total gzip; every chunk is within policy budget.

### 18.3 Manual acceptance boundary

The automated contract and artifact read-back checks are complete. Live click/download acceptance in the in-app browser could not be executed in this session because no controllable browser tab was available. The TCS and financial-institution manual matrix in section 14 remains the operational smoke test when a browser surface is available; it is not a missing repository implementation phase.
