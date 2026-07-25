import { AuditSubmissionMeta, persistAuditBlob, persistAuditEvent } from "../../lib/audit";
import { buildAnalysisPublicationSnapshot } from "../../lib/publication/analysisPublicationSnapshot";
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { EngineConfig, RecastPeriod } from "../../engine/types";
import type { SanityAssessment } from "../../engine/ratioSanity";
import {
  assertReportArtifact,
  buildReportDocument,
  buildReportFilename,
  downloadBlob,
  renderReportDocumentHtml,
  renderReportDocumentPdf,
  type ReportDocumentV1,
  type ReportExportResult,
} from "../../reporting";
import {
  sha256Hex,
  hmacSha256Hex,
  bytesLength,
  escapeCsvCell,
} from "./AcademicReport.formatters";

type Publication = ReturnType<typeof buildAnalysisPublicationSnapshot>;
type GranularityChecklist = Publication["granularityChecklist"];
type ProvenanceRows = Publication["provenanceRows"];
type ValuationReadiness = Publication["valuationReadiness"];
type PolicyVersions = Publication["policyVersions"];
type Traceability = Publication["traceability"];
type RunIdentity = Publication["runIdentity"];
type ValuationResult = ReturnType<typeof computeValuation>;

export interface ReportDocumentContext {
  readonly companyId: string;
  readonly latestPeriod: string;
  readonly generatedAt?: string | undefined;
  readonly valuationReadiness: ValuationReadiness;
  readonly traceability: Traceability;
  readonly runIdentity: RunIdentity;
}

export interface TraceRecord {
  period: string;
  line: string;
  statement: string;
  key: string;
  value: number;
  matchType: string;
  note: string;
}

export function getChecklistCsv(granularityChecklist: GranularityChecklist): string {
  if (!granularityChecklist) return "";
  const header = [
    "id",
    "title",
    "status",
    "coveragePct",
    "matchedCount",
    "missingCount",
    "matchedKeys",
    "missingKeys",
    "note",
  ];
  const rows = granularityChecklist.items.map((item) => [
    item.id,
    item.title,
    item.status,
    item.coveragePct.toFixed(2),
    item.matchedKeys.length,
    item.missingKeys.length,
    item.matchedKeys.join(" | "),
    item.missingKeys.join(" | "),
    item.note,
  ]);
  return [header, ...rows].map((r) => r.map((c) => escapeCsvCell(c)).join(",")).join("\n");
}

export function getTraceCsv(traceRecords: TraceRecord[]): string {
  const header = ["period", "line", "statement", "key", "value", "matchType", "note"];
  const rows = traceRecords.map((r) => [
    r.period,
    r.line,
    r.statement,
    r.key,
    r.value,
    r.matchType,
    r.note,
  ]);
  return [header, ...rows].map((r) => r.map((c) => escapeCsvCell(c)).join(",")).join("\n");
}

export function getProvenanceAuditCsv(provenanceRows: ProvenanceRows): string {
  const header = ["line", "statement", "key", "matchType", "occurrences", "avgValue", "minValue", "maxValue"];
  const rows = provenanceRows.map((g) => [
    g.line,
    g.statement,
    g.key,
    g.matchType,
    g.occurrences,
    g.avgValue,
    g.minValue,
    g.maxValue,
  ]);
  return [header, ...rows].map((r) => r.map((c) => escapeCsvCell(c as string | number)).join(",")).join("\n");
}

export function getProvenanceAuditMarkdown(params: {
  data: RecastPeriod[];
  traceRecords: TraceRecord[];
  provenanceRows: ProvenanceRows;
}): string {
  const { data, traceRecords, provenanceRows } = params;
  const lines = [
    "# Mapping Provenance Audit Report",
    "",
    `Generated At: ${new Date().toISOString()}`,
    `Periods Covered: ${data[0]?.period_end ?? "N/A"} -> ${data[data.length - 1]?.period_end ?? "N/A"}`,
    `Trace Rows: ${traceRecords.length}`,
    "",
    "## Method",
    "This report aggregates line-level trace evidence from canonical variables to raw mapped keys.",
    "For each canonical line, it records statement, key selected, match mode, and observed value range.",
    "",
    "## Key Coverage Snapshot",
    "",
  ];

  const topLines = new Map<string, number>();
  for (const r of traceRecords) {
    topLines.set(r.line, (topLines.get(r.line) ?? 0) + 1);
  }
  const top = Array.from(topLines.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  lines.push("| Canonical Line | Trace Count |", "|---|---:|");
  for (const [line, n] of top) lines.push(`| ${line} | ${n} |`);

  lines.push("", "## Provenance Aggregation (Top 20 Rows)", "", "| Line | Statement | Key | Match | N | Avg | Min | Max |", "|---|---|---|---|---:|---:|---:|---:|");
  for (const row of provenanceRows.slice(0, 20)) {
    lines.push(
      `| ${row.line} | ${row.statement} | ${row.key} | ${row.matchType} | ${row.occurrences} | ${row.avgValue.toFixed(2)} | ${row.minValue.toFixed(2)} | ${row.maxValue.toFixed(2)} |`,
    );
  }

  lines.push("", "## Reproducibility Note", "Use traceability_appendix.csv/json for full row-level provenance.");
  return lines.join("\n");
}

export function createReportDocument(
  reportEl: HTMLDivElement | null,
  context: ReportDocumentContext,
): ReportDocumentV1 {
  if (!reportEl) throw new Error("The report surface is not available for export.");
  return buildReportDocument(reportEl, {
    companyId: context.companyId,
    latestPeriod: context.latestPeriod,
    generatedAt: context.generatedAt,
    runId: context.runIdentity?.runId ?? null,
    reproducibilityHash: context.runIdentity?.reproducibilityHash ?? null,
    rigorLabel: context.traceability.rigor.currentLabel,
    confidenceStatus: context.traceability.confidence.status,
    valuationStatus: context.valuationReadiness.status,
  });
}

export async function generatePdfBlob(
  reportEl: HTMLDivElement | null,
  context: ReportDocumentContext,
): Promise<Blob> {
  return renderReportDocumentPdf(createReportDocument(reportEl, context));
}

export async function runExportPdf(params: {
  reportEl: HTMLDivElement | null;
  data: RecastPeriod[];
  companyId: string;
  valuationReadiness: ValuationReadiness;
  traceability: Traceability;
  runIdentity: RunIdentity;
  auditMeta: AuditSubmissionMeta | null | undefined;
}): Promise<ReportExportResult> {
  const { reportEl, data, companyId, valuationReadiness, traceability, runIdentity, auditMeta } = params;
  const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
  const blob = await generatePdfBlob(reportEl, {
    companyId,
    latestPeriod,
    valuationReadiness,
    traceability,
    runIdentity,
  });
  const filename = buildReportFilename(companyId, latestPeriod, "academic-report", "pdf");
  const receipt = downloadBlob(blob, filename);
  let auditStatus: ReportExportResult["auditStatus"] = "not-requested";
  if (auditMeta) {
    const persisted = await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "report-pdf-exported",
      file: blob,
      filename,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/pdf",
    });
    auditStatus = persisted ? "stored" : "unavailable";
  }
  return Object.freeze({ format: "pdf", ...receipt, auditStatus });
}

export async function runExportIcBundle(params: {
  reportEl: HTMLDivElement | null;
  data: RecastPeriod[];
  traceRecords: TraceRecord[];
  provenanceRows: ProvenanceRows;
  granularityChecklist: GranularityChecklist;
  valuationReadiness: ValuationReadiness;
  policyVersions: PolicyVersions;
  traceability: Traceability;
  runIdentity: RunIdentity;
  companyId: string;
  hmacKeyId: string;
  hmacSecret: string;
  auditMeta: AuditSubmissionMeta | null | undefined;
}): Promise<ReportExportResult> {
  const {
    reportEl,
    data,
    traceRecords,
    provenanceRows,
    granularityChecklist,
    valuationReadiness,
    policyVersions,
    traceability,
    runIdentity,
    companyId,
    hmacKeyId,
    hmacSecret,
    auditMeta,
  } = params;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
  const filename = buildReportFilename(companyId, latestPeriod, "ic-bundle", "zip");

  const generatedAt = new Date().toISOString();
  const files: Array<{ name: string; content: string | Blob; mime: string }> = [];

  const reportDocument = createReportDocument(reportEl, {
    companyId,
    latestPeriod,
    generatedAt,
    valuationReadiness,
    traceability,
    runIdentity,
  });
  const pdfBlob = await renderReportDocumentPdf(reportDocument);
  files.push({
    name: buildReportFilename(companyId, latestPeriod, "academic-report", "pdf"),
    content: pdfBlob,
    mime: "application/pdf",
  });
  files.push({
    name: "report_document.json",
    content: JSON.stringify(reportDocument, null, 2),
    mime: "application/json",
  });
  files.push({
    name: "report_document.html",
    content: renderReportDocumentHtml(reportDocument),
    mime: "text/html",
  });

  if (granularityChecklist) {
    const checklistCsv = getChecklistCsv(granularityChecklist);
    const checklistJson = JSON.stringify(
      {
        generatedAt,
        summary: granularityChecklist.summary,
        items: granularityChecklist.items,
      },
      null,
      2
    );
    files.push({ name: "granularity_checklist_audit.csv", content: checklistCsv, mime: "text/csv" });
    files.push({ name: "granularity_checklist_audit.json", content: checklistJson, mime: "application/json" });
  }

  const traceCsv = getTraceCsv(traceRecords);
  const traceJson = JSON.stringify(
    {
      generatedAt,
      runIdentity,
      periods: data.map((p) => p.period_end),
      rows: traceRecords,
    },
    null,
    2
  );
  files.push({ name: "traceability_appendix.csv", content: traceCsv, mime: "text/csv" });
  files.push({ name: "traceability_appendix.json", content: traceJson, mime: "application/json" });

  const provCsv = getProvenanceAuditCsv(provenanceRows);
  const provMd = getProvenanceAuditMarkdown({ data, traceRecords, provenanceRows });
  files.push({ name: "provenance_audit_report.csv", content: provCsv, mime: "text/csv" });
  files.push({ name: "provenance_audit_report.md", content: provMd, mime: "text/markdown" });

  for (const f of files) {
    zip.file(f.name, f.content);
  }

  const fileChecksums = await Promise.all(
    files.map(async (f) => ({
      file: f.name,
      mime: f.mime,
      bytes: await bytesLength(f.content),
      sha256: await sha256Hex(f.content),
    }))
  );

  const manifestCore = {
    generatedAt,
    reportDocumentSchema: reportDocument.schemaVersion,
    bundle: filename,
    companyId,
    periodRange: {
      start: data[0]?.period_end ?? null,
      end: data[data.length - 1]?.period_end ?? null,
      count: data.length,
    },
    valuation: {
      status: valuationReadiness.status,
      anchorPeriod: valuationReadiness.anchorPeriod,
      latestSourcePeriod: valuationReadiness.latestPeriod,
      terminalFlags: valuationReadiness.terminalFlagLabels,
      reasons: valuationReadiness.reasons,
    },
    policyVersions,
    traceability,
    runIdentity,
    rowCounts: {
      recastPeriods: data.length,
      traceRows: traceRecords.length,
      granularityItems: granularityChecklist?.items.length ?? 0,
      granularityPass: granularityChecklist?.summary.pass ?? 0,
      granularityPartial: granularityChecklist?.summary.partial ?? 0,
      granularityFail: granularityChecklist?.summary.fail ?? 0,
      reportBlocks: reportDocument.blocks.length,
    },
    checksums: fileChecksums,
    algorithm: "SHA-256",
  };

  const manifestCoreString = JSON.stringify(manifestCore, null, 2);
  const manifestPayloadSha256 = await sha256Hex(manifestCoreString);

  let signature: {
    mode: "hmac-sha256" | "unsigned";
    keyId: string | null;
    inputSha256: string;
    hmacSha256: string | null;
  } = {
    mode: "unsigned",
    keyId: null,
    inputSha256: manifestPayloadSha256,
    hmacSha256: null,
  };

  if (hmacSecret.trim()) {
    const hmac = await hmacSha256Hex(manifestCoreString, hmacSecret);
    signature = {
      mode: "hmac-sha256",
      keyId: hmacKeyId.trim() || "IC-LOCAL-KEY",
      inputSha256: manifestPayloadSha256,
      hmacSha256: hmac,
    };
  }

  const manifest = {
    ...manifestCore,
    signature,
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const bundleBlob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  await assertReportArtifact(bundleBlob, "zip");
  const receipt = downloadBlob(bundleBlob, filename);
  let auditStatus: ReportExportResult["auditStatus"] = "not-requested";
  if (auditMeta) {
    const persisted = await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "ic-bundle-exported",
      file: bundleBlob,
      filename,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/zip",
    });
    const manifestPersisted = await persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "ic-bundle-manifest",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: manifest,
    });
    auditStatus = persisted && manifestPersisted ? "stored" : "unavailable";
  }
  return Object.freeze({ format: "zip", ...receipt, auditStatus });
}

export async function runExportWorkbook(params: {
  companyId: string;
  valuationReadiness: ValuationReadiness;
  policyVersions: PolicyVersions;
  traceability: Traceability;
  runIdentity: RunIdentity;
  auditMeta: AuditSubmissionMeta | null | undefined;
  data: RecastPeriod[];
  valuation: ValuationResult;
  config: EngineConfig;
  ratioSanity: SanityAssessment | null | undefined;
}): Promise<ReportExportResult> {
  const {
    companyId,
    valuationReadiness,
    policyVersions,
    traceability,
    runIdentity,
    auditMeta,
    data,
    valuation,
    config,
    ratioSanity,
  } = params;
  const { generateValuationWorkbookFromPublicationSnapshot } = await import("../../engine/excelExport");
  const wbArray = await generateValuationWorkbookFromPublicationSnapshot({
    snapshot: {
      companyId: companyId ?? null,
      valuationReadiness,
      policyVersions,
      traceability,
      auditMeta,
      runIdentity,
    },
    recastData: data,
    forecastScenarios: [],
    valuation,
    config,
    ratioSanity,
  });
  const blob = new Blob([wbArray], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await assertReportArtifact(blob, "xlsx");
  const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
  const filename = buildReportFilename(companyId, latestPeriod, "institutional-workbook", "xlsx");
  const receipt = downloadBlob(blob, filename);
  let auditStatus: ReportExportResult["auditStatus"] = "not-requested";
  if (auditMeta) {
    const persisted = await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "workbook-exported",
      file: blob,
      filename,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    auditStatus = persisted ? "stored" : "unavailable";
  }
  return Object.freeze({ format: "xlsx", ...receipt, auditStatus });
}
