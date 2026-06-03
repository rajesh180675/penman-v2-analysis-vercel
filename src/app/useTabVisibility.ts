/* ================================================================
   useTabVisibility — extracted from AppShell.tsx

   Determines which tabs are visible based on the current analysis
   state (hasRecast, bankResult, scopeAwareResult, etc.) and handles
   the financial-institution auto-redirect effect.
================================================================ */

import { useMemo, useEffect } from "react";
import { RawPeriodData, RecastPeriod, CompanyRegistry } from "../engine/types";
import { isAuditEnabled, AuditSubmissionMeta } from "../lib/audit";
import { listWorkspaceCompanies } from "../lib/researchWorkspace";
import { QualityGateReport } from "../engine/mappingAudit";
import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import type { ScopeAwareResult } from "../engine/scopeAwareLoader";
import { TABS, type TabId } from "./tabs";

export interface TabVisibilityInputs {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  debugInfo: unknown | null;
  qualityGate: QualityGateReport | null;
  bankResult: FinancialInstitutionAnalysisResult | null;
  scopeAwareResult: ScopeAwareResult | null;
  auditMeta: AuditSubmissionMeta | null;
  registry: CompanyRegistry;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export interface TabVisibilityReturn {
  visibleTabs: typeof TABS;
  hasRecast: boolean;
  hasDebug: boolean;
  hasWorkspace: boolean;
  valuationBlocked: boolean;
  scopeBlocked: boolean;
  financialFallbackAvailable: boolean;
  readyCompanyCount: number;
  workspaceCompanies: ReturnType<typeof listWorkspaceCompanies>;
}

/**
 * Derives tab visibility from analysis state and handles financial-
 * institution auto-redirect.
 *
 * Extracted from AppShell to reduce its complexity. The tab visibility
 * logic involves 15+ conditional branches across 11 tab IDs — keeping
 * it inline made AppShell hard to reason about.
 */
export function useTabVisibility(inputs: TabVisibilityInputs): TabVisibilityReturn {
  const {
    rawData, recastData, debugInfo, qualityGate, bankResult,
    scopeAwareResult, auditMeta, registry, activeTab, setActiveTab,
  } = inputs;

  const hasRecast = (recastData?.length ?? 0) > 0;
  const hasDebug = debugInfo !== null;
  const workspaceCompanies = listWorkspaceCompanies();
  const hasWorkspace = hasRecast || Boolean(rawData?.length) || workspaceCompanies.length > 0;
  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment.blocked);
  const financialFallbackAvailable = Boolean(scopeBlocked && rawData && rawData.length > 0 && !hasRecast);
  const valuationTabEnabled = hasRecast || financialFallbackAvailable;

  // Financial-institution auto-redirect: when the pipeline produced a
  // bankResult or identified an unsupported scope (insurance), steer
  // the user away from the blank "statements" tab.
  useEffect(() => {
    if (!hasRecast && rawData && rawData.length > 0) {
      if (bankResult && activeTab === "statements") {
        setActiveTab("bank");
      } else if (scopeBlocked && !bankResult && activeTab === "statements") {
        // Insurance / unsupported financial — redirect to debug with context
        setActiveTab("debug");
      }
    }
  }, [bankResult, hasRecast, activeTab, scopeBlocked, rawData, setActiveTab]);

  const readyCompanyCount = useMemo(
    () => Object.values(registry.companies).filter((c) => c.recastData.length > 0).length,
    [registry],
  );

  const visibleTabs = useMemo(() => TABS.filter(t => {
    if (t.id === "debug") return hasDebug;
    if (t.id === "comparison") return readyCompanyCount >= 2;
    if (t.id === "inspector") return isAuditEnabled() && Boolean(auditMeta);
    if (t.id === "watchlist") return hasWorkspace;
    if (t.id === "workspace") return hasWorkspace;
    if (t.id === "valuation") return valuationTabEnabled;
    // Bank/NBFC tab: show when bankResult exists, even without industrial recast
    if (t.id === "bank") return hasRecast || bankResult !== null;
    // Dashboard: show for banks/NBFCs too (bankResult carries the analysis)
    if (t.id === "dashboard") return hasRecast || bankResult !== null;
    // Ratios + Quality: show for banks — FinancialInstitutionReport renders NIM/ROA/ROE trends
    if (t.id === "ratios") return hasRecast || bankResult !== null;
    if (t.id === "quality") return hasRecast || bankResult !== null;
    // Scope tab — visible only when both consolidated AND standalone are loaded
    // and the gap analysis succeeded. Phase A.
    if (t.id === "scope") return scopeAwareResult !== null;
    // Report tab: show for banks too — FinancialInstitutionReport renders from bankResult
    if (t.id === "report") return hasRecast || bankResult !== null;
    if (t.needsData) return hasRecast;
    return true;
  }), [hasDebug, readyCompanyCount, auditMeta, hasWorkspace, valuationTabEnabled, hasRecast, bankResult, scopeAwareResult]);

  return {
    visibleTabs,
    hasRecast,
    hasDebug,
    hasWorkspace,
    valuationBlocked,
    scopeBlocked,
    financialFallbackAvailable,
    readyCompanyCount,
    workspaceCompanies,
  };
}
