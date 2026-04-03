import { CompanyRegistry } from "../engine/types";
import { buildCompanyRegistrySnapshot, readCompanyRegistrySnapshot } from "./companyRegistrySnapshot";
import {
  WorkspaceAnalysisSnapshot,
  WorkspaceCompanyRecord,
  WorkspacePortfolioPlan,
  WorkspaceResearchJournalEntry,
  WorkspaceValuationSnapshot,
} from "./researchWorkspace";

async function postJson(path: string, payload: unknown) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } catch {
    return null;
  }
}

async function getJson(path: string) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } catch {
    return null;
  }
}

export interface SharedResearchBundle {
  companyId: string;
  profile?: {
    companyId?: string;
    updatedAt?: string | null;
    issuer?: WorkspaceCompanyRecord["issuer"] | null;
    notebook?: WorkspaceCompanyRecord["notes"] | null;
    portfolio?: WorkspaceCompanyRecord["portfolio"] | null;
  } | null;
  filings: WorkspaceCompanyRecord["filings"];
  valuations: WorkspaceValuationSnapshot[];
  journal: WorkspaceResearchJournalEntry[];
  alerts: Array<Record<string, unknown>>;
  analysis: WorkspaceAnalysisSnapshot[];
}

export async function syncWorkspaceProfile(company: WorkspaceCompanyRecord | null) {
  if (!company) return null;
  return postJson("/api/research", {
    companyId: company.companyId,
    kind: "profile",
    issuer: company.issuer,
    notebook: company.notes,
    portfolio: company.portfolio,
  });
}

export async function syncWorkspaceAnalysis(companyId: string, analysis: WorkspaceAnalysisSnapshot | null) {
  if (!companyId || !analysis) return null;
  return postJson("/api/research", {
    companyId,
    kind: "analysis",
    analysis,
  });
}

export async function syncWorkspaceFilings(companyId: string, filings: WorkspaceCompanyRecord["filings"]) {
  const latest = filings[0];
  if (!companyId || !latest) return null;
  return postJson("/api/research", {
    companyId,
    kind: "filing",
    filing: latest,
  });
}

export async function syncWorkspaceValuation(companyId: string, valuation: WorkspaceValuationSnapshot | null) {
  if (!companyId || !valuation) return null;
  return postJson("/api/research", {
    companyId,
    kind: "valuation",
    valuation,
  });
}

export async function syncWorkspacePortfolio(companyId: string, portfolio: WorkspacePortfolioPlan) {
  if (!companyId) return null;
  return postJson("/api/research", {
    companyId,
    kind: "portfolio",
    portfolio,
  });
}

export async function syncWorkspaceJournal(companyId: string, journal: WorkspaceResearchJournalEntry | null) {
  if (!companyId || !journal) return null;
  return postJson("/api/research", {
    companyId,
    kind: "journal",
    journal,
  });
}

export async function syncWorkspaceAlert(companyId: string, alert: Record<string, unknown> | null) {
  if (!companyId || !alert) return null;
  return postJson("/api/research", {
    companyId,
    kind: "alert",
    alert,
  });
}

export async function syncSharedComparisonRegistry(registry: CompanyRegistry) {
  if (!Object.keys(registry.companies).length) return null;
  return postJson("/api/research", {
    kind: "comparison-registry",
    comparisonRegistry: buildCompanyRegistrySnapshot(registry),
  });
}

export async function fetchSharedResearchBundle(companyId: string) {
  if (!companyId) return null;
  return getJson(`/api/research?companyId=${encodeURIComponent(companyId)}`) as Promise<SharedResearchBundle | null>;
}

export async function fetchSharedComparisonRegistry() {
  const payload = await getJson("/api/research?kind=comparison-registry");
  if (!payload) return null;
  return readCompanyRegistrySnapshot(payload);
}
