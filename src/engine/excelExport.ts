/**
 * Excel Workbook Generator — Institutional Grade (G-02)
 * 7-sheet workbook: Cover + Raw Data + Reformulated Statements +
 * N&P Ratio Decomposition + Forecast Model + Valuation Summary + Quality Scores.
 *
 * Runtime export now uses an ExcelJS-backed writer behind an internal workbook adapter.
 * This module is part of the publication/export architecture and should evolve toward
 * a canonical publication snapshot input instead of independently assembling report context.
 * Spec: Module G, Feature G-02
 */
import type { EngineConfig, ForecastScenario, RecastPeriod, ValuationResult } from "./types";
import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import { buildMappingDiscrepancyRows, buildProvenanceAuditRows } from "./provenanceAudit";
import type { AnalysisPolicyVersions } from "./policyVersions";
import type { SanityAssessment } from "./ratioSanity";
import type { WorkBook } from "./excelExport/xlsx";
import { utils, writeWorkbookArray } from "./excelExport/xlsx";
import {
  buildCoverSheet,
  buildTraceabilitySheet,
  buildRatioSanitySheet,
  buildRecastSheet,
} from "./excelExport/sheetsCore";
export type { WorkbookExportMetadata } from "./excelExport/sheetsCore";
import type { WorkbookExportMetadata } from "./excelExport/sheetsCore";
import {
  buildRatioSheet,
  buildForecastSheet,
  buildValuationSheet,
  buildQualitySheet,
} from "./excelExport/sheetsAnalytics";

export function workbookMetadataFromPublicationSnapshot(snapshot: {
  companyId: string | null;
  valuationReadiness: {
    status: "production-ready" | "warning" | "guarded";
    reasons: string[];
    anchorPeriod: string | null;
    latestPeriod: string | null;
  };
  policyVersions: AnalysisPolicyVersions;
  traceability: AnalysisTraceabilityEnvelope;
  auditMeta?: { runId?: string | null } | null | undefined;
}): WorkbookExportMetadata {
  return {
    companyLabel: snapshot.companyId ?? undefined,
    auditRunId: snapshot.auditMeta?.runId ?? undefined,
    valuationStatus: snapshot.valuationReadiness.status,
    valuationReasons: snapshot.valuationReadiness.reasons,
    valuationAnchorPeriod: snapshot.valuationReadiness.anchorPeriod,
    valuationSourcePeriod: snapshot.valuationReadiness.latestPeriod,
    policyVersions: snapshot.policyVersions,
    traceability: snapshot.traceability,
  };
}

export async function generateValuationWorkbook(
  recastData: RecastPeriod[],
  forecastScenarios: ForecastScenario[],
  valuation: ValuationResult,
  config: EngineConfig,
  metadata?: WorkbookExportMetadata | undefined,
): Promise<ArrayBuffer> {
  const wb: WorkBook = utils.book_new();

  utils.book_append_sheet(wb, buildCoverSheet(config, recastData.length, metadata), "Cover");
  utils.book_append_sheet(wb, buildRecastSheet(recastData), "Recast Statements");
  utils.book_append_sheet(wb, buildRatioSheet(recastData), "N&P Ratios");

  if (forecastScenarios.length > 0) {
    utils.book_append_sheet(wb, buildForecastSheet(forecastScenarios), "Forecast Model");
  }

  utils.book_append_sheet(wb, buildValuationSheet(valuation, config, metadata), "Valuation");
  utils.book_append_sheet(wb, buildQualitySheet(recastData), "Quality Scores");
  utils.book_append_sheet(wb, buildTraceabilitySheet(metadata), "Traceability");
  utils.book_append_sheet(wb, buildRatioSanitySheet(metadata), "Ratio Sanity");

  const provenanceRows = buildProvenanceAuditRows(recastData);
  if (provenanceRows.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(provenanceRows), "Provenance Audit");
  }
  const discrepancyRows = buildMappingDiscrepancyRows(recastData);
  if (discrepancyRows.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(discrepancyRows), "Mapping Discrepancies");
  }

  return await writeWorkbookArray(wb) as ArrayBuffer;
}

export async function generateValuationWorkbookFromPublicationSnapshot(params: {
  snapshot: {
    companyId: string | null;
    valuationReadiness: {
      status: "production-ready" | "warning" | "guarded";
      reasons: string[];
      anchorPeriod: string | null;
      latestPeriod: string | null;
    };
    policyVersions: AnalysisPolicyVersions;
    traceability: AnalysisTraceabilityEnvelope;
    auditMeta?: { runId?: string | null } | null | undefined;
  };
  recastData: RecastPeriod[];
  forecastScenarios: ForecastScenario[];
  valuation: ValuationResult;
  config: EngineConfig;
  ratioSanity?: SanityAssessment | null | undefined;
}): Promise<ArrayBuffer> {
  const metadata = workbookMetadataFromPublicationSnapshot(params.snapshot);
  metadata.ratioSanity = params.ratioSanity ?? null;
  return generateValuationWorkbook(
    params.recastData,
    params.forecastScenarios,
    params.valuation,
    params.config,
    metadata,
  );
}
