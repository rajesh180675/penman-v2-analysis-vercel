import { useEffect, useRef } from "react";
import type { RawPeriodData, RecastPeriod, EngineConfig } from "../engine/types";
import type { CapitalineParseDebug } from "../engine/capitalineParser";
import type { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import type { QualityGateReport } from "../engine/mappingAudit";
import type { MappingAuditReport } from "../engine/mappingAudit";
import type { AnalysisStatusSummary } from "../engine/analysisStatus";
import {
  AuditSubmissionMeta,
  persistAuditEvent,
} from "../lib/audit";
import { buildAnalysisSnapshot } from "../lib/auditSnapshot";

interface AuditPersistenceInputs {
  auditMeta: AuditSubmissionMeta | null;
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  debugInfo: CapitalineParseDebug | null;
  parserDiagnostics: SourceParserDiagnostics | null;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  engineError: string | null;
  analysisStatus: AnalysisStatusSummary;
  activeTab: string;
}

/**
 * Persists audit events to the remote audit store when audit is enabled.
 * Handles: analysis snapshots, engine errors, run status changes, and tab changes.
 * All persistence is fire-and-forget with deduplication via signature refs.
 */
export function useAuditPersistence({
  auditMeta,
  rawData,
  recastData,
  config,
  debugInfo,
  parserDiagnostics,
  qualityGate,
  mappingAudit,
  engineError,
  analysisStatus,
  activeTab,
}: AuditPersistenceInputs): void {
  const lastAuditSignatureRef = useRef<string | null>(null);
  const lastAuditStatusRef = useRef<string | null>(null);
  const lastTabAuditRef = useRef<string | null>(null);

  // Persist analysis snapshot when data or config changes
  useEffect(() => {
    if (!auditMeta || !rawData) return;

    const snapshot = buildAnalysisSnapshot({
      rawData,
      recastData,
      config,
      debugInfo,
      parserDiagnostics,
      qualityGate,
      mappingAudit,
      engineError,
      analysisStatus,
      auditMeta,
    });
    const signature = JSON.stringify(snapshot);
    if (signature === lastAuditSignatureRef.current) return;
    lastAuditSignatureRef.current = signature;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "analysis-snapshot",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: snapshot,
    });
  }, [analysisStatus, auditMeta, config, debugInfo, engineError, mappingAudit, parserDiagnostics, qualityGate, rawData, recastData]);

  // Persist engine error events
  useEffect(() => {
    if (!auditMeta || !engineError) return;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "engine-error",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: { error: engineError },
    });
  }, [auditMeta, engineError]);

  // Persist run status transitions
  useEffect(() => {
    if (!auditMeta || !rawData) return;

    const nextStatus = engineError
      ? `analysis-error:${engineError}`
      : recastData && recastData.length > 0
        ? `analysis-ready:${recastData.length}`
        : "data-loaded";

    if (lastAuditStatusRef.current === nextStatus) return;
    lastAuditStatusRef.current = nextStatus;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: engineError ? "run-status-error" : recastData && recastData.length > 0 ? "run-status-analysis-ready" : "run-status-data-loaded",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: {
        activeTab,
        periodCount: rawData.length,
        recastPeriodCount: recastData?.length ?? 0,
        error: engineError ?? null,
      },
    });
  }, [activeTab, auditMeta, engineError, rawData, recastData]);

  // Persist tab changes
  useEffect(() => {
    if (!auditMeta) return;

    const tabKey = `${auditMeta.runId}:${activeTab}`;
    if (lastTabAuditRef.current === tabKey) return;
    lastTabAuditRef.current = tabKey;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "ui-tab-changed",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: { activeTab },
    });
  }, [activeTab, auditMeta]);
}
