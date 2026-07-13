import { AuditSubmissionMeta, persistAuditBlob, persistAuditEvent } from "../../lib/audit";
import { buildAnalysisPublicationSnapshot } from "../../lib/publication/analysisPublicationSnapshot";
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { EngineConfig, RecastPeriod } from "../../engine/types";
import type { SanityAssessment } from "../../engine/ratioSanity";
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

export async function generatePdfBlob(reportEl: HTMLDivElement | null): Promise<Blob | null> {
  if (!reportEl) return null;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const canvas = await html2canvas(reportEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#f8fafc",
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 8;
  const printWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * printWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, "PNG", margin, position, printWidth, imgHeight, undefined, "FAST");
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = margin - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "PNG", margin, position, printWidth, imgHeight, undefined, "FAST");
    heightLeft -= pageHeight - margin * 2;
  }

  return pdf.output("blob");
}

export async function runExportPdf(params: {
  reportEl: HTMLDivElement | null;
  data: RecastPeriod[];
  auditMeta: AuditSubmissionMeta | null | undefined;
}): Promise<void> {
  const { reportEl, data, auditMeta } = params;
  const blob = await generatePdfBlob(reportEl);
  if (!blob) return;
  const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
  if (auditMeta) {
    await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "report-pdf-exported",
      file: blob,
      filename: `academic_report_${latestPeriod}.pdf`,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/pdf",
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `academic_report_${latestPeriod}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
}): Promise<void> {
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

  const generatedAt = new Date().toISOString();
  const files: Array<{ name: string; content: string | Blob; mime: string }> = [];

  const pdfBlob = await generatePdfBlob(reportEl);
  if (pdfBlob) {
    files.push({
      name: `academic_report_${latestPeriod}.pdf`,
      content: pdfBlob,
      mime: "application/pdf",
    });
  }

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
    bundle: `ic_bundle_${latestPeriod}.zip`,
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

  const bundleBlob = await zip.generateAsync({ type: "blob" });
  if (auditMeta) {
    await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "ic-bundle-exported",
      file: bundleBlob,
      filename: `ic_bundle_${latestPeriod}.zip`,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/zip",
    });
    await persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "ic-bundle-manifest",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: manifest,
    });
  }
  const url = URL.createObjectURL(bundleBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ic_bundle_${latestPeriod}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
}): Promise<void> {
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
  const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
  if (auditMeta) {
    await persistAuditBlob({
      runId: auditMeta.runId,
      kind: "artifacts",
      eventType: "workbook-exported",
      file: blob,
      filename: `institutional_workbook_${latestPeriod}.xlsx`,
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `institutional_workbook_${latestPeriod}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
