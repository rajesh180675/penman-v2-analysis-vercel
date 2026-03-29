import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import katex from "katex";
import "katex/dist/katex.min.css";
import { EngineConfig, NP_BENCHMARKS, RawPeriodData, RecastPeriod, ke_from_config } from "../engine/types";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { evaluateGranularityChecklist } from "../engine/mappingAudit";
import { generateValuationWorkbook } from "../engine/excelExport";
import { buildProvenanceAuditRows } from "../engine/provenanceAudit";
import { deriveCompanyLabel, resolveValuationReadiness } from "../engine/valuationPolicy";
import { computeV3Analytics, V3AnalyticsBundle, computeAnchorTable } from "../engine/v3Analytics";
import { AuditSubmissionMeta, persistAuditBlob, persistAuditEvent } from "../lib/audit";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  rawData?: RawPeriodData[] | null;
  auditMeta?: AuditSubmissionMeta | null;
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d });

function cagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

async function sha256Hex(input: string | Blob): Promise<string> {
  const buffer = typeof input === "string" ? new TextEncoder().encode(input).buffer : await input.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function bytesLength(input: string | Blob): Promise<number> {
  if (typeof input === "string") return new TextEncoder().encode(input).length;
  return input.size;
}

function avg(vals: Array<number | null | undefined>): number | null {
  const f = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!f.length) return null;
  return f.reduce((s, v) => s + v, 0) / f.length;
}



function computeSection6BLocal(params: {
  primaryValue: number;
  ke: number;
  g: number;
  cse0: number;
  pvRE: number;
  reAnchor: number;
  explicitPeriods: number;
  periods: RecastPeriod[];
  shares: number | null;
  marketPrice: number | null | undefined;
  sharesSource: string;
}) {
  const { primaryValue, ke, g, cse0, pvRE, reAnchor, explicitPeriods, periods, shares, marketPrice, sharesSource } = params;
  if (!shares || shares <= 0) return { status: "shares_unavailable" as const };

  const intrinsic = primaryValue / shares;
  if (marketPrice == null || marketPrice <= 0) {
    return {
      status: "market_price_required" as const,
      shares,
      sharesSource,
      intrinsic,
      prompt: `Intrinsic value per share: ₹${intrinsic.toFixed(1)}. Enter market price to compute margin of safety and implied values.`,
    };
  }

  const marketCap = marketPrice * shares;
  const mos = (intrinsic - marketPrice) / marketPrice;

  const vAtG = (gt: number) => {
    if (gt >= ke - 0.001) return Number.POSITIVE_INFINITY;
    const cv = reAnchor * (1 + gt) / (ke - gt);
    return cse0 + pvRE + cv / Math.pow(1 + ke, explicitPeriods);
  };

  let impliedG: number | null = null;
  let lo = -0.10;
  let hi = ke - 0.005;
  if (vAtG(hi) >= marketCap && vAtG(lo) <= marketCap) {
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const vm = vAtG(mid);
      impliedG = mid;
      if (Math.abs(vm - marketCap) / Math.max(1, marketCap) < 0.001) break;
      if (vm < marketCap) lo = mid;
      else hi = mid;
    }
  }

  const vAtKe = (ket: number) => {
    if (ket <= g + 0.001) return Number.POSITIVE_INFINITY;
    const pv = periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + ket, idx + 1), 0);
    const cv = reAnchor * (1 + g) / (ket - g);
    return cse0 + pv + cv / Math.pow(1 + ket, explicitPeriods);
  };

  let impliedKe: number | null = null;
  let keLo = g + 0.005;
  let keHi = 0.25;
  if (vAtKe(keLo) >= marketCap) {
    for (let i = 0; i < 100; i++) {
      const mid = (keLo + keHi) / 2;
      const vm = vAtKe(mid);
      impliedKe = mid;
      if (Math.abs(vm - marketCap) / Math.max(1, marketCap) < 0.001) break;
      if (vm > marketCap) keLo = mid;
      else keHi = mid;
    }
  }

  return {
    status: "full" as const,
    shares,
    sharesSource,
    intrinsic,
    marketPrice,
    marketCap,
    mos,
    impliedG,
    impliedKe,
  };
}

function median(vals: Array<number | null | undefined>): number | null {
  const f = vals.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!f.length) return null;
  const m = Math.floor(f.length / 2);
  return f.length % 2 === 0 ? (f[m - 1] + f[m]) / 2 : f[m];
}

function madSigma(vals: number[]): number {
  if (vals.length < 2) return 0;
  const med = median(vals);
  if (med == null) return 0;
  const deviations = vals.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  return (mad ?? 0) * 1.4826;
}

function pickFaceValue(shareCapital: number | null | undefined, shareCount: number | null | undefined): number | null {
  if (shareCapital == null || shareCount == null || shareCount === 0) return null;
  const implied = Math.abs(shareCapital / shareCount);
  const common = [1, 2, 5, 10];
  let best: number | null = null;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const fv of common) {
    const err = Math.abs(implied - fv);
    if (err < bestErr) {
      bestErr = err;
      best = fv;
    }
  }
  return bestErr <= 1 ? best : null;
}

export default function AcademicReport({ data, config, rawData, auditMeta }: Props) {
  const eqROCE = katex.renderToString(String.raw`\mathrm{ROCE}_t = \frac{\mathrm{CNI}_t}{\overline{\mathrm{CSE}}}`,
    { throwOnError: false, displayMode: true });
  const eqRNOA = katex.renderToString(String.raw`\mathrm{RNOA}_t = \frac{\mathrm{OI}_t}{\overline{\mathrm{NOA}}}`,
    { throwOnError: false, displayMode: true });
  const eqRE = katex.renderToString(String.raw`\mathrm{RE}_t = \mathrm{CNI}_t - k_e\,\mathrm{CSE}_{t-1}`,
    { throwOnError: false, displayMode: true });
  const eqReOI = katex.renderToString(String.raw`\mathrm{ReOI}_t = \mathrm{OI}_t - k_w\,\mathrm{NOA}_{t-1}`,
    { throwOnError: false, displayMode: true });

  const reportRef = useRef<HTMLDivElement | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [hmacKeyId, setHmacKeyId] = useState("IC-LOCAL-KEY");
  const [hmacSecret, setHmacSecret] = useState("");

  const granularityChecklist = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateGranularityChecklist(rawData);
  }, [rawData]);

  const traceRecords = useMemo(() => {
    const rows: Array<{
      period: string;
      line: string;
      statement: string;
      key: string;
      value: number;
      matchType: string;
      note: string;
    }> = [];
    for (const p of data) {
      if (!p.trace) continue;
      for (const [line, entries] of Object.entries(p.trace)) {
        for (const e of entries) {
          rows.push({
            period: p.period_end,
            line,
            statement: e.statement,
            key: e.key,
            value: e.value,
            matchType: e.matchType,
            note: e.note ?? "",
          });
        }
      }
    }
    return rows;
  }, [data]);

  const provenanceRows = useMemo(() => buildProvenanceAuditRows(data), [data]);
  const valuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);

  const escapeCsvCell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const getChecklistCsv = () => {
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
  };

  const getTraceCsv = () => {
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
  };

  const getProvenanceAuditCsv = () => {
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
  };

  const getProvenanceAuditMarkdown = () => {
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
  };

  const generatePdfBlob = async () => {
    if (!reportRef.current) return null;
    const canvas = await html2canvas(reportRef.current, {
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
  };

  const exportPdf = async () => {
    if (!reportRef.current || exportingPdf) return;
    setExportingPdf(true);
    try {
      const blob = await generatePdfBlob();
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
    } finally {
      setExportingPdf(false);
    }
  };

  const exportIcBundle = async () => {
    if (exportingBundle || exportingPdf) return;
    setExportingBundle(true);
    try {
      const zip = new JSZip();
      const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";

      const generatedAt = new Date().toISOString();
      const files: Array<{ name: string; content: string | Blob; mime: string }> = [];

      const pdfBlob = await generatePdfBlob();
      if (pdfBlob) {
        files.push({
          name: `academic_report_${latestPeriod}.pdf`,
          content: pdfBlob,
          mime: "application/pdf",
        });
      }

      if (granularityChecklist) {
        const checklistCsv = getChecklistCsv();
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

      const traceCsv = getTraceCsv();
      const traceJson = JSON.stringify(
        {
          generatedAt,
          periods: data.map((p) => p.period_end),
          rows: traceRecords,
        },
        null,
        2
      );
      files.push({ name: "traceability_appendix.csv", content: traceCsv, mime: "text/csv" });
      files.push({ name: "traceability_appendix.json", content: traceJson, mime: "application/json" });

      const provCsv = getProvenanceAuditCsv();
      const provMd = getProvenanceAuditMarkdown();
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
    } finally {
      setExportingBundle(false);
    }
  };

  const exportWorkbook = async () => {
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const wbArray = generateValuationWorkbook(data, [], valuation, config, {
        companyLabel: companyId,
        valuationStatus: valuationReadiness.status,
        valuationReasons: valuationReadiness.reasons,
        valuationAnchorPeriod: valuationReadiness.anchorPeriod,
        valuationSourcePeriod: valuationReadiness.latestPeriod,
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
    } finally {
      setExportingXlsx(false);
    }
  };

  if (!data || data.length < 2) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
        <p className="font-semibold text-amber-800 text-lg">Need at least 2 periods to generate report</p>
        <p className="text-amber-700 text-sm mt-1">Upload full history to produce a rigorous academic narrative.</p>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const first = data[0];
  const years = Math.max(data.length - 1, 1);
  const companyId = deriveCompanyLabel(rawData, config.ticker, auditMeta?.companyId);
  const trailing = data.slice(Math.max(0, data.length - 5));
  const valuationData = data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1));
  const valuationLatest = valuationData[valuationData.length - 1];

  const salesCagr = cagr(first.is.Sales, latest.is.Sales, years);
  const cniCagr = cagr(first.is.CNI, latest.is.CNI, years);
  const cseCagr = cagr(first.bs.CSE, latest.bs.CSE, years);

  const roce5 = avg(trailing.map((d) => d.ratios?.ROCE));
  const rnoa5 = median(trailing.map((d) => d.ratios?.RNOA));
  const spread5 = median(trailing.map((d) => d.ratios?.SPREAD));
  const pm5 = avg(trailing.map((d) => d.ratios?.PM));
  const ato5 = median(trailing.map((d) => d.ratios?.ATO));
  const accrual5 = avg(trailing.map((d) => d.ratios?.accrual_ratio_bs));
  const ccr5 = avg(trailing.map((d) => d.ratios?.cash_conversion_ratio));
  const ccrLatest = latest.ratios?.cash_conversion_ratio ?? null;
  const steadyState = data.slice(Math.max(0, data.length - 2));
  const steadyRnoa = avg(steadyState.map((d) => d.ratios?.RNOA));
  const steadyAto = avg(steadyState.map((d) => d.ratios?.ATO));

  const noaDiagnostics = data.map((d) => ({
    period: d.period_end,
    noa: d.bs.NOA,
    sales: d.is.Sales,
    noaToSales: d.is.Sales > 0 ? Math.abs(d.bs.NOA) / d.is.Sales : null,
    flagged: d.is.Sales > 0 ? Math.abs(d.bs.NOA) < 0.1 * d.is.Sales : false,
    indAs116Era: Number.parseInt(d.period_end.slice(0, 4), 10) >= 2020,
  }));
  const noaFlagCount = noaDiagnostics.filter((d) => d.flagged).length;
  const noaShiftSeries = data.slice(1).map((d, idx) => {
    const prev = data[idx];
    return {
      period: d.period_end,
      deltaNOA: d.bs.NOA - prev.bs.NOA,
      deltaOA: d.bs.OA - prev.bs.OA,
      deltaFA: d.bs.FA - prev.bs.FA,
      deltaOL: d.bs.OL - prev.bs.OL,
      deltaFO: d.bs.FO - prev.bs.FO,
    };
  });
  const largestNoaShift = noaShiftSeries.reduce((best, row) =>
    Math.abs(row.deltaNOA) > Math.abs(best.deltaNOA) ? row : best,
    noaShiftSeries[0] ?? { period: latest.period_end, deltaNOA: 0, deltaOA: 0, deltaFA: 0, deltaOL: 0, deltaFO: 0 },
  );

  // S-9.4: ke from config — prefer explicit config.ke over rf+erp
  const ke = ke_from_config(config);
  const kwSeries: number[] = [];
  for (let i = 1; i < valuationData.length; i++) {
    kwSeries.push(deriveKwFromStructure(valuationData[i], valuationData[i - 1], ke, config.risk_free_rate, config));
  }
  const kw = kwSeries.length ? kwSeries[kwSeries.length - 1] : ke;
  const kwMedian = median(kwSeries);
  const gInput = Math.min(0.05, Math.max(0.02, (salesCagr ?? 0.04) * 0.5));
  const nominalGdpProxy = 0.06;
  const gCapCandidates = [
    { label: "75% of Sales CAGR", value: Math.max(0, (salesCagr ?? 0.04) * 0.75) },
    { label: "nominal GDP proxy", value: nominalGdpProxy },
    { label: "ke - 2% floor", value: Math.max(0, ke - 0.02) },
  ];
  const bindingGCap = gCapCandidates.reduce((a, b) => (a.value < b.value ? a : b));
  const g = Math.max(0, Math.min(gInput, bindingGCap.value));
  const valuation = computeValuation(valuationData, ke, kw, g, config);
  const valuationLegacyKw = computeValuation(valuationData, ke, config.risk_free_rate, g, config);
  const reoiIdentityGap = Math.abs(valuation.V_RE_CV3 - valuation.V_ReOI_CV03);
  const reoiIdentityGapPct = valuation.V_RE_CV3 !== 0 ? reoiIdentityGap / Math.abs(valuation.V_RE_CV3) : null;

  // §14 V3 Composite Confidence Score
  const v3Bundle: V3AnalyticsBundle | null = (() => {
    try {
      return computeV3Analytics(valuationData, config, valuation.V_RE_CV3, valuation.V_ReOI_CV03, config.g_terminal_override, kw);
    } catch { return null; }
  })();
  const v3ConfidenceScore = v3Bundle?.confidence.composite ?? null;
  const v3ConfidenceClass = v3Bundle?.confidence.classification ?? null;
  const v3TerminalAnchor = v3Bundle?.anchorResult;

  const sensitivityKe = [Math.max(0.05, ke - 0.04), Math.max(0.05, ke - 0.02), ke, ke + 0.02];
  // S-9.7: g columns must be strictly ascending (monotone)
  const gBase = v3TerminalAnchor?.g_applied ?? g;
  const sensitivityG = [Math.max(0.01, gBase - 0.02), Math.max(0.01, gBase - 0.01), gBase]
    .filter((gv, i, arr) => gv < ke - 0.005 && arr.indexOf(gv) === i)
    .sort((a, b) => a - b);
  const matrixREAnchor = v3TerminalAnchor?.RE_value;
  const sensitivityMatrix = sensitivityKe.map((keCase) => ({
    ke: keCase,
    values: sensitivityG.map((gCase) => computeValuation(valuationData, keCase, kw, gCase, config, matrixREAnchor).V_RE_CV3),
  }));

  const cumulativeDirtySurplus = data.slice(1).reduce((sum, d, idx) => {
    const prev = data[idx];
    return sum + ((d.bs.CSE - prev.bs.CSE) - d.is.CNI + d.cf.d_t);
  }, 0);
  const periodDiagnostics = data.slice(1).map((d, idx) => {
    const prev = data[idx];
    const ds = (d.bs.CSE - prev.bs.CSE) - d.is.CNI + d.cf.d_t;
    const dsWarnThreshold = Math.max(0.05 * prev.bs.CSE, 0.03 * prev.bs.TA);
    const dsCritical = Math.abs(ds) > 0.1 * prev.bs.CSE;
    const dsWarn = Math.abs(ds) > dsWarnThreshold;
    const dDisc = d.cf.d_t_discrepancy;
    const capitalTxLikely = Math.abs(dDisc) > Math.max(Math.abs(d.is.CNI) * 0.2, 0.05 * prev.bs.CSE);
    const pmHist = data.slice(0, idx + 1).map((p) => p.ratios?.PM).filter((v): v is number => v != null);
    const pmMed = median(pmHist) ?? 0;
    const pmSigma = madSigma(pmHist);
    const pmZ = pmSigma > 0 ? ((d.ratios?.PM ?? 0) - pmMed) / pmSigma : 0;
    const largeComponentDecline = (
      (d.bs.OA - prev.bs.OA < -0.15 * prev.bs.OA && Math.abs(d.bs.OA - prev.bs.OA) > 0.02 * prev.bs.TA)
      || (d.bs.FA - prev.bs.FA < -0.15 * prev.bs.FA && Math.abs(d.bs.FA - prev.bs.FA) > 0.02 * prev.bs.TA)
      || (d.bs.OL - prev.bs.OL < -0.15 * prev.bs.OL && Math.abs(d.bs.OL - prev.bs.OL) > 0.02 * prev.bs.TA)
      || (d.bs.FO - prev.bs.FO < -0.15 * prev.bs.FO && Math.abs(d.bs.FO - prev.bs.FO) > 0.02 * prev.bs.TA)
    );
    const flags: string[] = [];
    if (dsCritical) flags.push("STRUCTURAL_EVENT_CRITICAL");
    else if (dsWarn) flags.push("STRUCTURAL_EVENT");
    if (capitalTxLikely) flags.push("CAPITAL_TRANSACTION_LIKELY");
    if (Math.abs(pmZ) > 3) flags.push("PM_OUTLIER_CRITICAL");
    else if (Math.abs(pmZ) > 2) flags.push("PM_OUTLIER_WARNING");
    if (largeComponentDecline) flags.push("LARGE_COMPONENT_DECLINE");
    return { period: d.period_end, ds, dDisc, pmZ, flags };
  });
  const latestDiag = periodDiagnostics[periodDiagnostics.length - 1];
  const prevLatest = data[data.length - 2];
  const accrualDeltaReceivables = latest.bs.TradeReceivables - prevLatest.bs.TradeReceivables;
  const accrualDeltaInventory = latest.bs.Inventory - prevLatest.bs.Inventory;
  const accrualDeltaPayables = latest.bs.TradePayables - prevLatest.bs.TradePayables;
  const accrualWorkingCapitalProxy = accrualDeltaReceivables + accrualDeltaInventory - accrualDeltaPayables;
  const accrualDeltaOtherOA = (latest.bs.OA - prevLatest.bs.OA) - accrualDeltaReceivables - accrualDeltaInventory;
  const accrualDeltaOtherOL = (latest.bs.OL - prevLatest.bs.OL) - accrualDeltaPayables;
  const accrualOtherProxy = accrualDeltaOtherOA - accrualDeltaOtherOL;
  const accrualTotalProxy = accrualWorkingCapitalProxy + accrualOtherProxy;
  const accrualSeries = data.slice(1).map((d) => ({ period: d.period_end, accrual: d.ratios?.accrual_ratio_bs ?? null }));
  const latestAccrual = latest.ratios?.accrual_ratio_bs ?? null;

  const fScore = latest.quality?.piotroski_total ?? null;
  const dilutionRecent = data.slice(Math.max(0, data.length - 5)).reduce((sum, d) => sum + Math.max(0, d.cf.EquityIssued || 0), 0);
  const ratioTimeline = data.map((d) => ({
    period: d.period_end,
    PM: d.ratios?.PM ?? null,
    ROCE: d.ratios?.ROCE ?? null,
    FLEV: d.ratios?.FLEV ?? null,
    payout: d.is.CNI !== 0 ? d.cf.DividendPaid / d.is.CNI : null,
    flags: periodDiagnostics.find((x) => x.period === d.period_end)?.flags ?? [],
  }));
  const explicitHorizonYears = Math.max(valuation.reSeries.length, 0);
  const terminalWeightRE = valuation.V_RE_CV3 !== 0
    ? ((valuation.CV_RE / Math.pow(1 + valuation.ke, explicitHorizonYears)) / valuation.V_RE_CV3)
    : null;
  const latestEq16Residual = latest.ratios?.ROCE_eq16_error ?? null;
  const latestRe = valuation.reSeries.length ? valuation.reSeries[valuation.reSeries.length - 1].RE : null;
  const dividendCashGap = latest.cf.DividendPaid - latest.cf.FCF_cash;
  const faRunwayYears = dividendCashGap > 0 ? latest.bs.FA / dividendCashGap : null;
  const mScore = latest.quality?.beneish_mscore ?? null;
  const zScore = latest.quality?.altman_zprime ?? null;

  const zZone = zScore == null ? "N/A" : zScore > 2.9 ? "Safe" : zScore > 1.23 ? "Grey" : "Distress";
  const mFlag = mScore != null && mScore > -1.78;
  const eq16ResidualPp = latestEq16Residual != null ? latestEq16Residual * 100 : null;
  const eq16Tier = eq16ResidualPp == null ? "N/A" : Math.abs(eq16ResidualPp) > 15 ? "CRITICAL" : Math.abs(eq16ResidualPp) > 5 ? "ELEVATED" : Math.abs(eq16ResidualPp) >= 2 ? "WARNING" : "OK";
  const reSeriesVals = valuation.reSeries.map((r) => r.RE);
  const rePrev = reSeriesVals.length >= 2 ? reSeriesVals[reSeriesVals.length - 2] : null;
  const reMedian = median(reSeriesVals);
  const terminalReAnomaly = latestRe != null && ((rePrev != null && latestRe > 2 * rePrev) || (reMedian != null && latestRe > 2.5 * reMedian));
  const terminalFlagCount = (latestDiag?.flags.length ?? 0)
    + (terminalReAnomaly ? 1 : 0)
    + (Math.abs(eq16ResidualPp ?? 0) > 15 ? 1 : 0)
    + ((reoiIdentityGapPct ?? 0) > 0.2 ? 1 : 0);
  const confidenceTier = terminalFlagCount >= 3 ? "structurally compromised" : terminalFlagCount === 2 ? "multiple anomalies" : terminalFlagCount === 1 ? "one anomaly" : "clean";
  const tvContaminated = terminalReAnomaly && ((latestDiag?.flags.length ?? 0) > 0);
  const primaryValuation = v3TerminalAnchor?.V_total ?? valuation.V_RE_CV3;
  const tvShare = v3TerminalAnchor?.TV_share ?? terminalWeightRE;
  const tvGrade = v3TerminalAnchor?.TV_grade ?? (tvShare == null ? "N/A" : tvShare < 0.25 ? "GRADE_A" : tvShare < 0.4 ? "GRADE_B" : tvShare < 0.6 ? "GRADE_C" : "GRADE_D");
  const anchorTable = v3TerminalAnchor
    ? computeAnchorTable(valuation.CSE0, valuation.pvRE, v3TerminalAnchor, ke, explicitHorizonYears)
    : [];

  const sharesFromConfig = config.shares_outstanding ?? null;
  const rawLatest = rawData?.[rawData.length - 1]?.raw_metric_values;
  const shareCapital = rawLatest?.["Share Capital"] ?? rawLatest?.["Equity Share Capital"] ?? null;
  const inferredFaceValue = pickFaceValue(shareCapital, sharesFromConfig);
  const inferredShares = shareCapital != null && inferredFaceValue != null ? shareCapital / inferredFaceValue : null;
  const sharesToUse = sharesFromConfig ?? inferredShares;
  const local6B = computeSection6BLocal({
    primaryValue: primaryValuation,
    ke,
    g: gBase,
    cse0: valuation.CSE0,
    pvRE: valuation.pvRE,
    reAnchor: v3TerminalAnchor?.RE_value ?? (latestRe ?? 0),
    explicitPeriods: Math.max(explicitHorizonYears, 1),
    periods: valuationData,
    shares: sharesToUse,
    marketPrice: config.market_price,
    sharesSource: sharesFromConfig != null ? "user input" : (inferredShares != null ? `share capital ÷ FV ₹${num(inferredFaceValue,0)}` : "unavailable"),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <div className="mr-auto grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
          <input
            value={hmacKeyId}
            onChange={(e) => setHmacKeyId(e.target.value)}
            placeholder="HMAC Key ID"
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
          <input
            type="password"
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
            placeholder="HMAC Secret (optional)"
            className="px-3 py-2 rounded-lg text-xs border border-slate-300 bg-white"
          />
        </div>
        <button
          onClick={exportWorkbook}
          disabled={exportingBundle || exportingPdf || exportingXlsx}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            exportingBundle || exportingPdf || exportingXlsx
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {exportingXlsx ? "Building XLSX..." : "Export Institutional XLSX"}
        </button>
        <button
          onClick={exportPdf}
          disabled={exportingPdf || exportingBundle}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            exportingPdf || exportingBundle
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {exportingPdf ? "Generating PDF..." : "Export Report as PDF"}
        </button>
        <button
          onClick={exportIcBundle}
          disabled={exportingBundle || exportingPdf}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
            exportingBundle || exportingPdf
              ? "bg-indigo-200 text-indigo-100 border-indigo-200 cursor-not-allowed"
              : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {exportingBundle ? "Building IC Bundle..." : "Export IC Bundle (ZIP)"}
        </button>
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        If HMAC Secret is provided, manifest.json includes tamper-evident HMAC-SHA256 signature over the manifest payload.
      </p>

      <div ref={reportRef} className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">Investor Research Memorandum (Academic Format)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Framework: Nissim &amp; Penman (2001), residual-income valuation with operating/financing recast under Ind AS.
        </p>
        <p className="text-xs text-slate-600 mt-2">Company ID: <b>{companyId}</b> · Sample window: <b>{first.period_end.slice(0, 10)}</b> to <b>{latest.period_end.slice(0, 10)}</b>.
          {/* S-11.1: contamination guard — display ke/kw derivation info */}
          {valuationReadiness.status !== "production-ready" && (
            <span className="ml-2 text-amber-700 font-semibold">
              Guarded valuation mode — anchor period {valuationReadiness.anchorPeriod?.slice(0, 10) ?? "n/a"}.
            </span>
          )}
        </p>
        {valuationReadiness.status !== "production-ready" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">Valuation status: {valuationReadiness.status}</div>
            <div className="mt-1">{valuationReadiness.reasons[0]}</div>
            {valuationReadiness.terminalFlagLabels.length > 0 && (
              <div className="mt-2 text-xs">
                Terminal flags: <b>{valuationReadiness.terminalFlagLabels.join(", ")}</b>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
          <Kpi label="Latest ROCE" value={pct(latest.ratios?.ROCE)} />
          <Kpi label="Latest RNOA" value={pct(latest.ratios?.RNOA)} />
          {/* S-11.5: use guarded (primaryValuation) when contamination tier is GUARDED/COMPROMISED */}
          <Kpi label={valuationReadiness.status !== "production-ready" ? "V(RE,CV3) [guarded]" : "V(RE, CV3)"} value={`₹${num(primaryValuation ?? valuation.V_RE_CV3)} Cr`} />
          <Kpi label="Separation Confidence" value={`${latest.bs.separationScore}/100`} />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">1) Executive Findings</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Over the sample ({first.period_end.slice(0, 4)} to {latest.period_end.slice(0, 4)}), Sales CAGR = <b>{pct(salesCagr)}</b>,
            CNI CAGR = <b>{pct(cniCagr)}</b>, and book equity CAGR = <b>{pct(cseCagr)}</b>.
          </li>
          <li>
            Five-period central-tendency profitability (median for NOA-sensitive ratios): ROCE <b>{pct(roce5)}</b>, RNOA <b>{pct(rnoa5)}</b>, Spread <b>{pct(spread5)}</b>; steady-state (latest 2y) RNOA <b>{pct(steadyRnoa)}</b>.
          </li>
          <li>
            Operations profile: PM <b>{pct(pm5)}</b> and ATO <b>{num(ato5, 2)}x</b> (median), benchmarked versus N&amp;P medians
            ({(NP_BENCHMARKS.PM.median * 100).toFixed(1)}% and {NP_BENCHMARKS.ATO.median.toFixed(2)}x).
          </li>
          <li>
            Earnings quality: accrual ratio (BS) latest = <b>{pct(latestAccrual)}</b>, cash conversion ratio latest = <b>{num(ccrLatest, 2)}x</b> (5Y average {num(ccr5, 2)}x); historical 5Y average accrual ({pct(accrual5)}) is transition-driven by NOA regime shifts.
          </li>
          <li>
            Quality diagnostics: Piotroski F-score <b>{fScore ?? "—"}/9</b>, Beneish M-score <b>{mScore?.toFixed(2) ?? "—"}</b>
            {mFlag ? " (watchlist)" : " (clean threshold)"}, Altman Z' <b>{zScore?.toFixed(2) ?? "—"}</b> ({zZone});
            valuation identity gap |RE−ReOI| = <b>₹{num(reoiIdentityGap)} Cr</b> ({pct(reoiIdentityGapPct)}).
          </li>
          <li>
            Valuation confidence: <b>{confidenceTier}</b> ({terminalFlagCount} terminal-period flags). Terminal-value dependence tier: <b>{tvGrade}</b> at <b>{pct(tvShare, 1)}</b>.
            {" "}Valuation status: <b>{valuationReadiness.status}</b> with anchor period <b>{valuationLatest.period_end.slice(0, 10)}</b>.
            {v3ConfidenceScore != null && (
              <> — <b>Composite Confidence: {v3ConfidenceScore.toFixed(0)}/100 ({v3ConfidenceClass})</b>
              {v3TerminalAnchor && <> | Terminal anchor: <b>{v3TerminalAnchor.label}</b> (g = {pct(v3TerminalAnchor.g_applied)})</>}</>
            )}
          </li>
        </ul>
        {v3Bundle?.crossSectionIssues?.length ? (
          <div className="mt-3 text-xs text-amber-700">
            <b>Consistency warnings:</b>
            <ul className="list-disc pl-5 mt-1">
              {v3Bundle.crossSectionIssues.map((issue, idx) => <li key={idx}>{issue}</li>)}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">2) Methodology — Nissim & Penman (2001) Framework</h2>
        <div className="text-sm text-slate-700 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.1 Operating / Financing Separation</h3>
            <p>
              The engine implements the N&amp;P (2001) separation of all assets and liabilities into operating (OA, OL)
              and financing (FA, FO) categories. Financial assets include cash, short-term investments, long-term
              investments, deposits, and interest/dividend receivables. Financial obligations include all borrowings,
              lease liabilities (Ind AS 116), hybrid perpetual securities (when classified as debt per user config),
              and other financial liabilities. Operating assets (OA = TA − FA) and operating liabilities (OL =
              TotalLiabilities − FO) are derived by difference. All identities are enforced: NOA = OA − OL =
              CSE + MI + NFO; OI = CNI + NFE + MII. The separation confidence score (0–100) reflects how many
              granular sub-components were successfully mapped vs. derived by difference.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.2 India-Specific Adjustments (Ind AS)</h3>
            <p>
              (a) <b>Ind AS 116 Leases:</b> Right-of-use assets and lease liabilities are automatically included in
              OA and FO respectively (effective from FY2020 for listed Indian entities). This increases both NOA and
              NFO relative to pre-Ind AS 116 periods, creating a time-series discontinuity. The engine flags this.
            </p>
            <p className="mt-1">
              (b) <b>Deferred Tax:</b> DTL is classified within OL; DTA in OA. The engine provides a DTA/DTL flag
              when DTA exceeds 3% of TA.
            </p>
            <p className="mt-1">
              (c) <b>Exceptional Items:</b> Ind AS does not permit "exceptional items below the line" (unlike old
              Indian GAAP). The engine classifies pre-tax exceptional items tagged in Capitaline as UOI
              (Unusual OI), taxed at the effective rate, and excludes them from Core OI.
            </p>
            <p className="mt-1">
              (d) <b>OCI Treatment:</b> Under current config, OCI is treated as unusual and excluded from Core OI.
              This is configurable. For companies with significant actuarial gains/losses or fair-value changes,
              treating OCI as operating may be more appropriate.
            </p>
            <p className="mt-1">
              (e) <b>No LIFO:</b> Indian GAAP and Ind AS do not permit LIFO inventory costing. The LIFO reserve
              adjustment that US-focused N&amp;P analyses apply is inapplicable here; LIFO_reserve = 0 throughout.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.3 Profitability Decomposition (Eq.1–16)</h3>
            <p>
              The engine implements the full N&amp;P profitability bridge. ROCE = RNOA + FLEV × SPREAD
              (Eq. 4/5, N&amp;P 2001). Operating profitability decomposes as RNOA = PM × ATO (Eq. 7/8).
              Operating liability leverage adds: RNOA = ROOA + OLLEV × OLSPREAD (Eq. 11, N&amp;P 2001).
              The full Eq. 16 bridge decomposes ROCE into: CoreSalesPM × ATO + CoreOtherItems/NOA +
              UOI/NOA + OLLEV × OLSPREAD + FLEV × CoreSPREAD + FLEV × (UOI/NOA − UFE/NFO).
              The reconstruction residual (ROCE − ROCE_eq16) quantifies the bridge closure error.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.4 Valuation Models</h3>
            <p>
              <b>RE model (Eq. 1a):</b> V = CSE₀ + Σ PV(RE_t) + PV(CV_RE), where RE_t = CNI_t − k_e × CSE_(t-1).
              Three continuing values: CV1 (zero), CV2 (perpetuity), CV3 (Gordon growth at rate g).
            </p>
            <p className="mt-1">
              <b>ReOI model (Eq. 9):</b> EV = NOA₀ + Σ PV(ReOI_t) + PV(CV_ReOI), where ReOI_t = OI_t − k_w × NOA_(t-1).
              Equity value = EV − NFO_latest. Preferred when FA/FO separation is reliable.
            </p>
            <p className="mt-1">
              <b>FCFF/FCFE:</b> FCFF_t = NOPAT_t − ΔNOA_t; FCFE_t = CNI_t − ΔCSE_t. Discounted at k_w and k_e
              respectively. Under clean-surplus and consistent assumptions, FCFF converges with ReOI (algebraic identity).
            </p>
            <p className="mt-1">
              <b>AEG (Ohlson-Juettner 2005):</b> Short-cut proxy: V = CNI₁/k_e + Σ PV(AEG_t),
              where AEG_t = CNI_t − ρ_e × CNI_(t-1). This implements the historical-data version of the OJ model.
            </p>
            <p className="mt-1">
              <b>Reverse DCF:</b> Bisection search over the RE Gordon CV formula to back-solve for the growth rate
              g* implied by the entered market capitalisation (market_price × shares_outstanding).
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.5 Forecasting (Fade Analysis)</h3>
            <p>
              Forecast drivers (Sales growth, Core PM, ATO, FLEV, NBC) are faded from their latest historical values
              toward N&amp;P (2001) Table 1 long-run medians using AR(1) fade parameters from N&amp;P Table 3:
              FADE_CoreSalesPM = 0.87, FADE_ATO = 0.95, FADE_Sales_growth = 0.70. Bull/Bear scenarios scale
              drivers proportionally. Probability-weighted expected value uses entered scenario probabilities. Compare this mechanical fade with the observed PM trajectory in Section 5B before finalizing valuation anchors.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.6 Data Source Mapping</h3>
            <p>
              This analysis used {rawData ? `${rawData.length} period(s) of data` : "uploaded financial data"}
              processed through the Capitaline Ind AS CSV parser with 350+ line-item mapping rules.
              The Provenance Audit tab lists every canonical variable with its source mapping, match type
              (exact/fuzzy/derived), and value. The separation confidence score is{" "}
              {data.length > 0 ? `${data[data.length - 1].bs.separationScore}/100` : "—"}.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Core Equations (N&amp;P 2001)</div>
            <div dangerouslySetInnerHTML={{ __html: eqROCE }} className="mb-2" />
            <div dangerouslySetInnerHTML={{ __html: eqRNOA }} />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Residual Income Definitions</div>
            <div dangerouslySetInnerHTML={{ __html: eqRE }} className="mb-2" />
            <div dangerouslySetInnerHTML={{ __html: eqReOI }} />
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3) Profitability and Growth Diagnostics</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Latest</th>
                <th className="px-3 py-2 text-right">5Y Robust</th>
                <th className="px-3 py-2 text-right">N&amp;P Median</th>
                <th className="px-3 py-2 text-left">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <Row metric="ROCE" latest={pct(latest.ratios?.ROCE)} avg5={pct(roce5)} bm={`${(NP_BENCHMARKS.ROCE.median * 100).toFixed(1)}%`} note="Shareholder return on common equity." />
              <Row metric="RNOA" latest={pct(latest.ratios?.RNOA)} avg5={pct(rnoa5)} bm={`${(NP_BENCHMARKS.RNOA.median * 100).toFixed(1)}%`} note="Core operating profitability net of operating liabilities." />
              <Row metric="Spread" latest={pct(latest.ratios?.SPREAD)} avg5={pct(spread5)} bm={`${(NP_BENCHMARKS.SPREAD.median * 100).toFixed(1)}%`} note="Value creation wedge between operating return and financing cost." />
              <Row metric="PM" latest={pct(latest.ratios?.PM)} avg5={pct(pm5)} bm={`${(NP_BENCHMARKS.PM.median * 100).toFixed(1)}%`} note="Operating margin after comprehensive classification." />
              <Row metric="ATO" latest={`${num(latest.ratios?.ATO, 2)}x`} avg5={`${num(ato5, 2)}x`} bm={`${NP_BENCHMARKS.ATO.median.toFixed(2)}x`} note="Operating asset productivity / turnover." />
              <Row metric="Steady-state RNOA (2Y avg)" latest={pct(steadyRnoa)} avg5="—" bm={`${(NP_BENCHMARKS.RNOA.median * 100).toFixed(1)}%`} note="Use for post-transition anchoring when NOA regime shifts." />
              <Row metric="Steady-state ATO (2Y avg)" latest={`${num(steadyAto, 2)}x`} avg5="—" bm={`${NP_BENCHMARKS.ATO.median.toFixed(2)}x`} note="Recent capital-intensity regime productivity." />
              <Row metric="Sales CAGR" latest={pct(salesCagr)} avg5="—" bm="—" note="Top-line growth trajectory over full sample." />
              <Row metric="CNI CAGR" latest={pct(cniCagr)} avg5="—" bm="—" note="Growth in comprehensive earnings available to common." />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">NOA-sensitive ratios (RNOA, Spread, ATO) use 5Y median to prevent denominator-driven explosions when NOA is near zero.</p>
      </section>

      {v3Bundle?.versionChangeLog.length ? (
      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">2.6A) Methodology Changes from Prior Version</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Variable</th>
                <th className="px-2 py-1 text-right">Prior</th>
                <th className="px-2 py-1 text-right">Current</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {v3Bundle.versionChangeLog.map((c, i) => (
                <tr key={`${c.variable}_${i}`}>
                  <td className="px-2 py-1">{c.variable}</td>
                  <td className="px-2 py-1 text-right">{num(c.old_value, 4)}</td>
                  <td className="px-2 py-1 text-right">{num(c.new_value, 4)}</td>
                  <td className="px-2 py-1 text-right">{pct(c.delta_pct, 1)}</td>
                  <td className="px-2 py-1 text-amber-700">{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3A) NOA denominator diagnostics (all periods)</h2>
        <p className="text-sm text-slate-700 mb-3">Flag rule: |NOA| &lt; 10% of Sales. Flagged periods: <b>{noaFlagCount}</b> / {noaDiagnostics.length}.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">NOA (₹ Cr)</th>
                <th className="px-2 py-1 text-right">Sales (₹ Cr)</th>
                <th className="px-2 py-1 text-right">|NOA|/Sales</th>
                <th className="px-2 py-1 text-left">Flag</th>
                <th className="px-2 py-1 text-left">Regime</th>
                <th className="px-2 py-1 text-left">Interpretation</th>
                <th className="px-2 py-1 text-left">Lease era</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {noaDiagnostics.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{num(row.noa)}</td>
                  <td className="px-2 py-1 text-right">{num(row.sales)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.noaToSales, 1)}</td>
                  <td className="px-2 py-1">{row.flagged ? "⚠️ small NOA" : "OK"}</td>
                  <td className="px-2 py-1">{row.indAs116Era ? "FY2020+" : "Pre-FY2020"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3B) NOA structural-break diagnostics</h2>
        <p className="text-sm text-slate-700 mb-3">
          Largest year-on-year NOA shift occurred in <b>{largestNoaShift.period.slice(0, 10)}</b>: ΔNOA <b>₹{num(largestNoaShift.deltaNOA)} Cr</b>,
          decomposed into ΔOA <b>₹{num(largestNoaShift.deltaOA)} Cr</b>, ΔOL <b>₹{num(largestNoaShift.deltaOL)} Cr</b>,
          ΔFA <b>₹{num(largestNoaShift.deltaFA)} Cr</b>, ΔFO <b>₹{num(largestNoaShift.deltaFO)} Cr</b>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">ΔNOA</th>
                <th className="px-2 py-1 text-right">ΔOA</th>
                <th className="px-2 py-1 text-right">ΔOL</th>
                <th className="px-2 py-1 text-right">ΔFA</th>
                <th className="px-2 py-1 text-right">ΔFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {noaShiftSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaNOA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaOA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaOL)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaFA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaFO)} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v3Bundle?.oaDecomposition?.length ? (
          <div className="mt-4 space-y-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">OA decomposition for selected structural periods</div>
            {v3Bundle.oaDecomposition.map((d) => (
              <div key={d.period_end} className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">{d.period_end.slice(0, 10)}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-1 text-right">ΔPPE</th>
                        <th className="px-2 py-1 text-right">ΔROU</th>
                        <th className="px-2 py-1 text-right">ΔInventory</th>
                        <th className="px-2 py-1 text-right">ΔReceivables</th>
                        <th className="px-2 py-1 text-right">ΔGoodwill</th>
                        <th className="px-2 py-1 text-right">ΔIntangibles</th>
                        <th className="px-2 py-1 text-right">ΔCWIP</th>
                        <th className="px-2 py-1 text-right">ΔDTA</th>
                        <th className="px-2 py-1 text-right">ΔOther OA</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaPPE)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaROU)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaInventory)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaReceivables)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaGoodwill)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaIntangibles)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaCWIP)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaDTA)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaOtherOA)} Cr</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {d.interpretation && <p className="text-xs text-slate-500 mt-2">{d.interpretation}</p>}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">4) Balance-Sheet Structure and Financing Posture</h2>
        <p className="text-sm text-slate-700 mb-3">
          Latest period decomposition indicates OA = <b>{num(latest.bs.OA)}</b>, FA = <b>{num(latest.bs.FA)}</b>,
          FO = <b>{num(latest.bs.FO)}</b>, and NFO = <b>{num(latest.bs.NFO)}</b>. A negative NFO indicates net financial assets,
          which typically dampens financing risk and shifts valuation reliance toward operating persistence.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <MiniBox label="Operating Liabilities (OL)" value={`₹${num(latest.bs.OL)} Cr`} />
          <MiniBox label="OL ex DTL base" value={`₹${num(latest.bs.OL_ex_DTL)} Cr`} />
          <MiniBox label="Imputed OL interest (io)" value={`₹${num(latest.ratios?.io)} Cr`} />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5) Cash-Flow Quality and Clean-Surplus Diagnostics</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Latest accounting FCF (Eq.14) = <b>₹{num(latest.cf.FCF_accounting)} Cr</b>; cash FCF proxy (CFO-Capex) =
            <b> ₹{num(latest.cf.FCF_cash)} Cr</b>.
          </li>
          <li>
            Dividend reconciliation (Eq.15): reported d_t = <b>₹{num(latest.cf.d_t)} Cr</b> vs formula d_t =
            <b> ₹{num(latest.cf.d_t_formula)} Cr</b>; discrepancy = <b>₹{num(latest.cf.d_t_discrepancy)} Cr</b>.
          </li>
          <li>
            Accrual discipline: latest BS accrual ratio <b>{pct(latestAccrual)}</b> and 5Y average <b>{pct(accrual5)}</b>; interpret historical spikes with the NOA transition context in Sections 3A/3B.
          </li>
          <li>
            Latest accrual decomposition proxy: ΔReceivables <b>₹{num(accrualDeltaReceivables)} Cr</b>, ΔInventory <b>₹{num(accrualDeltaInventory)} Cr</b>,
            ΔPayables <b>₹{num(accrualDeltaPayables)} Cr</b>, net working-capital accrual proxy <b>₹{num(accrualWorkingCapitalProxy)} Cr</b>.
          </li>
          <li>
            Other accrual proxy: ΔOther OA <b>₹{num(accrualDeltaOtherOA)} Cr</b>, ΔOther OL <b>₹{num(accrualDeltaOtherOL)} Cr</b>,
            net other accrual proxy <b>₹{num(accrualOtherProxy)} Cr</b>; total accrual proxy <b>₹{num(accrualTotalProxy)} Cr</b>.
          </li>
          <li>
            Cumulative dirty-surplus check Σ(ΔCSE − CNI + d) = <b>₹{num(v3Bundle?.dirtySurplusFramework.cumulative ?? cumulativeDirtySurplus)} Cr</b>
            ({pct(v3Bundle?.dirtySurplusFramework.pct_cse ?? null)} of latest equity).
            {v3Bundle?.dirtySurplusFramework && (
              <> Decomposition — Structural events: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.structural_events)} Cr</b>,
              Accounting transitions: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.accounting_transitions)} Cr</b>,
              Steady-state: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.steady_state)} Cr</b>.</>
            )}
          </li>
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5A) Accrual-ratio time series</h2>
        <p className="text-xs text-slate-500 mb-3">This series helps separate transition-year accrual spikes from current-period earnings quality.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">BS accrual ratio</th>
                <th className="px-2 py-1 text-left">Flag</th>
                <th className="px-2 py-1 text-left">Regime</th>
                <th className="px-2 py-1 text-left">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accrualSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.accrual, 1)}</td>
                  <td className="px-2 py-1">{row.accrual != null && Math.abs(row.accrual) > 0.1 ? `⚠️ ${row.accrual > 0 ? ">" : "<"}10%` : "OK"}</td>
                  <td className="px-2 py-1">{data.find((d) => d.period_end === row.period)?.ratios?.accrual_regime ?? "NORMAL"}</td>
                  <td className="px-2 py-1 text-slate-600">{(() => {
                    const p = data.find((d) => d.period_end === row.period);
                    const regime = p?.ratios?.accrual_regime;
                    if (regime === "QUALITY_ACCRUAL") return "Earnings persistence concern.";
                    if (regime === "GROWTH_ACCRUAL") return "Accruals consistent with growth in operating assets.";
                    if (regime === "ASSET_DISPOSAL") return "Asset reduction / disposal period.";
                    if (row.accrual == null) return "Accrual ratio undefined.";
                    return "";
                  })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5B) Operating trajectory timeline (full sample)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">PM</th>
                <th className="px-2 py-1 text-right">ROCE</th>
                <th className="px-2 py-1 text-right">FLEV</th>
                <th className="px-2 py-1 text-right">Dividend/CNI</th>
                <th className="px-2 py-1 text-left">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ratioTimeline.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.PM, 1)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.ROCE, 1)}</td>
                  <td className="px-2 py-1 text-right">{num(row.FLEV, 2)}x</td>
                  <td className="px-2 py-1 text-right">{pct(row.payout, 1)}</td>
                  <td className="px-2 py-1">{row.flags.length ? row.flags.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6) Valuation Synthesis (Residual Income Framework)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-4">
          <MiniBox label="ke assumption" value={pct(ke, 2)} />
          <MiniBox label="kw (derived, latest)" value={pct(kw, 2)} />
          <MiniBox label="kw (derived, median, historical artifact)" value={pct(kwMedian, 2)} />
          <MiniBox label="kw (legacy rf proxy)" value={pct(config.risk_free_rate, 2)} />
          <MiniBox label="Terminal growth g (effective)" value={pct(gBase, 2)} />
          <MiniBox label="Separation confidence" value={`${valuation.separationScore}/100`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-right">Zero CV</th>
                <th className="px-3 py-2 text-right">No-growth CV</th>
                <th className="px-3 py-2 text-right">Growth CV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2">Equity RE (Eq.1/1a)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV1)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV2)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-indigo-700">₹{num(valuation.V_RE_CV3)} Cr</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Operations-only ReOI (Eq.9)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV01)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV02)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700">₹{num(valuation.V_ReOI_CV03)} Cr</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Interpretation: when separation confidence is low, the RE line should be treated as primary and ReOI as corroborative only. Identity check (CV3): |RE−ReOI| = ₹{num(reoiIdentityGap)} Cr ({pct(reoiIdentityGapPct)}). Gap decomposition — Dirty surplus PV: ₹{num(v3Bundle?.reReoiGapDecomposition.dirty_surplus)} Cr, NFO timing: ₹{num(v3Bundle?.reReoiGapDecomposition.nfo_timing)} Cr, TV divergence: ₹{num(v3Bundle?.reReoiGapDecomposition.tv_divergence)} Cr, Explicit-period discounting: ₹{num(v3Bundle?.reReoiGapDecomposition.explicit_period_discounting)} Cr, Residual: ₹{num(v3Bundle?.reReoiGapDecomposition.residual)} Cr. Primary driver: {v3Bundle?.reReoiGapDecomposition.dominant_driver ?? "—"}. Legacy rf-based ReOI CV3 was ₹{num(valuationLegacyKw.V_ReOI_CV03)} Cr.
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Explicit residual-income horizon used in valuation: <b>{explicitHorizonYears}</b> yearly steps. Terminal-value share of guarded RE CV3: <b>{pct(tvShare, 1)}</b> ({tvGrade}). Eq.16 residual (latest): <b>{eq16ResidualPp != null ? `${eq16ResidualPp.toFixed(2)}pp` : "—"}</b> [{eq16Tier}].
          {v3TerminalAnchor && <> [As-reported TV share: <b>{pct(v3TerminalAnchor.TV_share_raw, 1)}</b> ({v3TerminalAnchor.TV_grade_raw}).]</>}.
          {data[data.length-1]?.ratios?.eq16_diagnosis && (
            <span className="text-amber-700"> §5.7 Eq.16 diagnosis: {data[data.length-1].ratios!.eq16_diagnosis}</span>
          )}
        </p>
        {g < gInput && (
          <p className="text-xs text-amber-700 mt-1">
            Terminal growth capped at <b>{pct(g, 2)}</b> (input was {pct(gInput, 2)}). Binding constraint: <b>{bindingGCap.label}</b>.
          </p>
        )}
        {tvContaminated && (
          <p className="text-xs text-amber-700 mt-1">
            ⚠ Terminal period ({latest.period_end.slice(0, 4)}) shows structural-event indicators. Primary valuation uses RE_(T-1)+growth anchor; as-reported anchor is shown for reference.
          </p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A) RE sensitivity matrix (ke × g)</h2>
        <p className="text-xs text-slate-500 mb-3">Rows vary cost of equity; columns vary terminal growth. Values are V(RE, CV3) in ₹ Cr using derived kw for ReOI consistency checks.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">ke \ g</th>
                {sensitivityG.map((gCase, idx) => (
                  <th key={idx} className="px-3 py-2 text-right">{pct(gCase, 2)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sensitivityMatrix.map((row) => (
                <tr key={row.ke}>
                  <td className="px-3 py-2">{pct(row.ke, 1)}</td>
                  {row.values.map((v, idx) => (
                    <td key={idx} className="px-3 py-2 text-right">₹{num(v)} Cr</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v3TerminalAnchor && (
          <p className="text-xs text-slate-500 mt-2">
            Matrix uses guarded terminal anchor ({v3TerminalAnchor.label}, RE = ₹{num(v3TerminalAnchor.RE_value)} Cr).
            As-reported anchor (RE_T = ₹{num(v3TerminalAnchor.reference_RE_T)} Cr) would produce values approximately {(v3TerminalAnchor.V_total > 0 ? (v3TerminalAnchor.reference_V / v3TerminalAnchor.V_total) : 1).toFixed(2)}× higher across the grid.
          </p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A.1) Explicit residual-income stream</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">RE</th>
                <th className="px-2 py-1 text-right">ReOI</th>
                <th className="px-2 py-1 text-right">DS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {valuation.reSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.RE)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.ReOI)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(periodDiagnostics.find((p) => p.period === row.period)?.ds)} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>


      {tvContaminated && (
      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A.2) Terminal sensitivity (alternate RE anchors)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">RE anchor</th>
                <th className="px-2 py-1 text-right">Value</th>
                <th className="px-2 py-1 text-right">TV share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {anchorTable.map((row) => (
                <tr key={row.label} className={v3TerminalAnchor?.label === row.label ? "bg-indigo-50" : ""}>
                  <td className="px-2 py-1">{row.label}{v3TerminalAnchor?.label === row.label ? " (selected)" : ""}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.V_RE_CV3)} Cr</td>
                  <td className="px-2 py-1 text-right">{pct(row.tv_share, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-2">Primary value (contamination guard): <b>₹{num(primaryValuation)} Cr</b>. Reference as-reported CV3 value: <b>₹{num(v3TerminalAnchor?.reference_V ?? valuation.V_RE_CV3)} Cr</b>.</p>
      </section>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6B) Per-share and market-implied checks</h2>
        {local6B.status === "shares_unavailable" && (
          <p className="text-sm text-amber-700">Share count could not be derived from available data. Enter shares outstanding and market price to complete this section.</p>
        )}
        {local6B.status !== "shares_unavailable" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr><td className="px-2 py-1">RE intrinsic per share</td><td className="px-2 py-1 text-right">{`₹${num(local6B.intrinsic, 1)}`}</td></tr>
                <tr><td className="px-2 py-1">Market price</td><td className="px-2 py-1 text-right">{local6B.status === "full" ? `₹${num(local6B.marketPrice, 1)}` : "—"}</td></tr>
                <tr><td className="px-2 py-1">Margin of safety</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.mos : null, 1)}</td></tr>
                <tr><td className="px-2 py-1">Implied growth g*</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.impliedG : null, 2)}</td></tr>
                <tr><td className="px-2 py-1">Implied ke</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.impliedKe : null, 2)}</td></tr>
                <tr><td className="px-2 py-1">Market cap</td><td className="px-2 py-1 text-right">{local6B.status === "full" ? `₹${num(local6B.marketCap)} Cr` : "—"}</td></tr>
                <tr><td className="px-2 py-1">Shares outstanding</td><td className="px-2 py-1 text-right">{`${num(local6B.shares, 0)} Cr`}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {local6B.status === "market_price_required" && (
          <p className="text-xs text-amber-700 mt-3">{local6B.prompt}</p>
        )}
        {local6B.status === "full" && (
          <p className="text-xs text-slate-600 mt-2">{local6B.mos > 0.2 ? "Substantial margin of safety." : local6B.mos > 0 ? "Modest margin of safety." : "Market price exceeds intrinsic estimate."}</p>
        )}
        {v3Bundle?.shareCount?.dilution_note && (
          <p className="text-xs text-slate-500 mt-1">Dilution note: {v3Bundle.shareCount.dilution_note}</p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6C) Quality Score Decomposition</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">Piotroski components</h3>
            <ul className="space-y-1 text-slate-700">
              <li>ROA positive: <b>{latest.quality?.piotroski_roa ?? "—"}</b></li>
              <li>ΔROA positive: <b>{latest.quality?.piotroski_delta_roa ?? "—"}</b></li>
              <li>CFO positive: <b>{latest.quality?.piotroski_cfo ?? "—"}</b></li>
              <li>CFO &gt; NI: <b>{latest.quality?.piotroski_accrual ?? "—"}</b></li>
              <li>Leverage down: <b>{latest.quality?.piotroski_leverage ?? "—"}</b></li>
              <li>Liquidity up: <b>{latest.quality?.piotroski_liquidity ?? "—"}</b></li>
              <li>No dilution: <b>{latest.quality?.piotroski_dilution ?? "—"}</b> (recent 5Y equity issuance: ₹{num(dilutionRecent)} Cr)</li>
              <li>Margin up: <b>{latest.quality?.piotroski_margin ?? "—"}</b></li>
              <li>Turnover up: <b>{latest.quality?.piotroski_turnover ?? "—"}</b></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">Altman Z' components</h3>
            <ul className="space-y-1 text-slate-700">
              <li>WC / TA: <b>{num(latest.quality?.altman_wc_ta, 3)}</b></li>
              <li>RE / TA: <b>{num(latest.quality?.altman_re_ta, 3)}</b></li>
              <li>EBIT / TA: <b>{num(latest.quality?.altman_ebit_ta, 3)}</b></li>
              <li>BVE / TL: <b>{num(latest.quality?.altman_bve_tl, 3)}</b></li>
              <li>Sales / TA: <b>{num(latest.quality?.altman_s_ta, 3)}</b></li>
            </ul>
            <p className="text-xs text-slate-500 mt-2">Altman Z' can understate safety for cash-rich firms because large financial assets raise total assets but do not proportionally raise EBIT.</p>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">7) Investment Interpretation and Monitoring Triggers</h2>
        <div className="text-sm text-slate-700 space-y-2">
          <p>
            <b>Base thesis support</b>: Persistent positive spread and stable/expanding PM with non-collapsing ATO indicate
            economic profitability above financing cost.
          </p>
          <p>
            <b>Primary downside triggers</b>: (i) spread compression via declining PM or rising NBC, (ii) accrual ratio drift above
            10%, (iii) Beneish flag migration above -1.78, (iv) Altman Z' migration toward distress band.
          </p>
          <p>
            <b>{companyId}-specific trigger — PM path</b>: PM is currently <b>{pct(latest.ratios?.PM)}</b>. Calibration base: <b>{pct(v3Bundle?.triggerCalibration.pm_base)}</b> ({v3Bundle?.triggerCalibration.pm_base_source ?? "latest"}). If PM falls below <b>{pct(v3Bundle?.triggerCalibration.pm_warning, 0)}</b>,
            re-underwrite with ke stress and steeper fade; below <b>{pct(v3Bundle?.triggerCalibration.pm_critical, 0)}</b>, valuation approaches lower sensitivity bounds.
          </p>
          <p>
            <b>{companyId}-specific trigger — dividend sustainability</b>: Dividend vs cash FCF gap is <b>₹{num(dividendCashGap)} Cr</b>
            ({dividendCashGap > 0 ? `FA runway ~${num(faRunwayYears, 1)} years at current gap.` : "covered by cash FCF."}).
          </p>
          <p>
            <b>{companyId}-specific trigger — capacity return realization</b>: Monitor whether RNOA remains above <b>{pct(v3Bundle?.triggerCalibration.rnoa_threshold, 0)}</b> and RE above
            <b> ₹{num(v3Bundle?.triggerCalibration.re_threshold)} Cr</b> (latest RE: <b>₹{num(latestRe)} Cr</b>).
          </p>
          <p>
            <b>Process recommendation</b>: update this report each filing cycle; monitor Eq.(4)/(7)/(15) residuals and mapping quality
            diagnostics to ensure model integrity remains audit-grade.
          </p>
        </div>
      </section>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-bold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="font-semibold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

function Row({ metric, latest, avg5, bm, note }: { metric: string; latest: string; avg5: string; bm: string; note: string }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-700">{metric}</td>
      <td className="px-3 py-2 text-right font-mono">{latest}</td>
      <td className="px-3 py-2 text-right font-mono">{avg5}</td>
      <td className="px-3 py-2 text-right font-mono text-slate-500">{bm}</td>
      <td className="px-3 py-2 text-slate-600 text-xs">{note}</td>
    </tr>
  );
}
