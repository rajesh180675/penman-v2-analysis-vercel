import { AnalysisStatusSummary } from "./analysisStatus";
import { RawPeriodData, RecastPeriod } from "./types";
import { AuditSubmissionMeta } from "../lib/audit";

interface FilingRecordShape {
  filingId: string;
  runId: string | null;
  sourceProvider: AuditSubmissionMeta["sourceMode"] | "workspace";
  periodEnd: string | null;
  filingDate: string;
  filingKind: "annual" | "quarterly" | "ttm" | "unknown";
  statementVersion: string;
  amendmentMarker: string | null;
  latestAnalysisStatus: string;
}

function inferFilingKind(rawData: RawPeriodData[] | null) {
  if (!rawData || rawData.length < 2) return "unknown" as const;
  const last = new Date(rawData[rawData.length - 1].period_end).getTime();
  const prev = new Date(rawData[rawData.length - 2].period_end).getTime();
  const gapDays = Math.round((last - prev) / (1000 * 60 * 60 * 24));
  if (gapDays < 120) return "quarterly" as const;
  if (gapDays < 240) return "ttm" as const;
  return "annual" as const;
}

export function buildFilingRecord(args: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
}): FilingRecordShape | null {
  const { rawData, recastData, analysisStatus, auditMeta } = args;
  const latestPeriod = rawData?.[rawData.length - 1]?.period_end ?? recastData?.[recastData.length - 1]?.period_end ?? null;
  if (!latestPeriod && !auditMeta?.runId) return null;

  const filingKind = inferFilingKind(rawData);
  return {
    filingId: `${auditMeta?.runId ?? "workspace"}:${latestPeriod ?? "unknown"}`,
    runId: auditMeta?.runId ?? null,
    sourceProvider: auditMeta?.sourceMode ?? "workspace",
    periodEnd: latestPeriod,
    filingDate: new Date().toISOString(),
    filingKind,
    statementVersion: "current",
    amendmentMarker: null,
    latestAnalysisStatus: analysisStatus?.label ?? "Unknown",
  };
}
