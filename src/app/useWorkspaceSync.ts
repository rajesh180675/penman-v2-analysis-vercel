/* ================================================================
   useWorkspaceSync — extracted from AppShell.tsx

   Handles two workspace persistence effects:
     1. rememberWorkspaceAnalysis  — debounced to avoid ~10+ writes
        during initialization (audit perf bug #15)
     2. syncWorkspaceProfile/Analysis — shared research API sync

   Both were previously inline useEffects in AppShell with 5+ deps
   each, firing redundantly on every config/analysisStatus change.
================================================================ */

import { useEffect, useRef } from "react";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { AuditSubmissionMeta } from "../lib/audit";
import { listWorkspaceCompanies, rememberWorkspaceAnalysis } from "../lib/researchWorkspace";
import { syncWorkspaceAnalysis, syncWorkspaceProfile } from "../lib/sharedResearchApi";

export interface WorkspaceSyncInputs {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  analysisStatus: AnalysisStatusSummary | null;
  auditMeta: AuditSubmissionMeta | null;
}

/**
 * Debounced workspace persistence + shared research API sync.
 *
 * The analysis derivation chain in useAuditAnalysis produces a cascade
 * of intermediate states (qualityGate → pipeline → recast → analysisStatus)
 * that each trigger re-renders. Without debouncing, rememberWorkspaceAnalysis
 * fires 10+ times during initialization before settling. This hook batches
 * those writes with an 800ms trailing debounce.
 */
export function useWorkspaceSync(inputs: WorkspaceSyncInputs) {
  const { rawData, recastData, config, analysisStatus, auditMeta } = inputs;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced workspace persistence ────────────────────────────────
  // Replaces the direct useEffect that fired on every analysisStatus /
  // config / rawData / recastData change. 800ms trailing edge ensures
  // we write once after the derivation chain settles.
  useEffect(() => {
    if (!rawData && !recastData) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      rememberWorkspaceAnalysis({
        rawData,
        recastData,
        config,
        analysisStatus,
        auditMeta,
      });
    }, 800);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [analysisStatus, auditMeta, config, rawData, recastData]);

  // ── Shared research API sync ───────────────────────────────────────
  useEffect(() => {
    const companyId = auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null;
    if (!companyId) return;
    const workspaceCompanies = listWorkspaceCompanies();
    const record = workspaceCompanies.find((item) => item.companyId === companyId) ?? null;
    if (!record) return;
    void syncWorkspaceProfile(record);
    if (record.analysisHistory[0]) void syncWorkspaceAnalysis(companyId, record.analysisHistory[0]);
  }, [analysisStatus, auditMeta?.companyId, rawData]);
}
