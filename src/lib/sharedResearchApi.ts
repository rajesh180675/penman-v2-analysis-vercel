import { CompanyRegistry } from "../engine/types";
import { buildCompanyRegistrySnapshot, readCompanyRegistrySnapshot } from "./companyRegistrySnapshot";
import { AfesBlackboardSnapshot, readAfesBlackboardSnapshot } from "./afesBlackboardSnapshot";
import {
  WorkspaceAnalysisSnapshot,
  WorkspaceCompanyRecord,
  WorkspacePortfolioPlan,
  WorkspaceResearchJournalEntry,
  WorkspaceValuationSnapshot,
} from "./researchWorkspace";

export interface SharedApiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  status: number | null;
}

async function postJsonWithStatus<T>(path: string, payload: unknown): Promise<SharedApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        ok: false,
        data: null,
        error: `Request failed: ${response.status}`,
        status: response.status,
      };
    }
    return {
      ok: true,
      data: await response.json() as T,
      error: null,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Network request failed.",
      status: null,
    };
  }
}

async function getJsonWithStatus<T>(path: string): Promise<SharedApiResult<T>> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return {
        ok: false,
        data: null,
        error: `Request failed: ${response.status}`,
        status: response.status,
      };
    }
    return {
      ok: true,
      data: await response.json() as T,
      error: null,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Network request failed.",
      status: null,
    };
  }
}

async function postJson(path: string, payload: unknown) {
  const result = await postJsonWithStatus(path, payload);
  return result.data;
}

async function getJson(path: string) {
  const result = await getJsonWithStatus(path);
  return result.data;
}

export function formatSharedApiStatus(result: SharedApiResult<unknown> | null | undefined, successLabel: string) {
  if (!result) return "Shared sync idle.";
  return result.ok ? successLabel : (result.error ?? "Shared sync failed.");
}

export function sharedApiHasError(result: SharedApiResult<unknown> | null | undefined) {
  return Boolean(result?.ok === false && result.error);
}

export function sharedApiStatusKind(result: SharedApiResult<unknown> | null | undefined) {
  if (!result) return "idle" as const;
  return result.ok ? "success" as const : "error" as const;
}

export function sharedApiBanner(result: SharedApiResult<unknown> | null | undefined, successLabel: string) {
  if (!result) return null;
  return {
    kind: sharedApiStatusKind(result),
    message: formatSharedApiStatus(result, successLabel),
  };
}

export function idleSharedApiResult<T>(): SharedApiResult<T> {
  return {
    ok: false,
    data: null,
    error: null,
    status: null,
  };
}

export function successSharedApiResult<T>(data: T | null, status: number | null = 200): SharedApiResult<T> {
  return {
    ok: true,
    data,
    error: null,
    status,
  };
}

export function failureSharedApiResult<T>(error: string, status: number | null = null): SharedApiResult<T> {
  return {
    ok: false,
    data: null,
    error,
    status,
  };
}

export function sharedApiData<T>(result: SharedApiResult<T> | null | undefined) {
  return result?.data ?? null;
}

export function sharedApiResultFromData<T>(data: T | null, successLabel = "Request completed."): SharedApiResult<T> {
  return data != null ? successSharedApiResult(data) : failureSharedApiResult(successLabel);
}

export function sharedApiStatusText(result: SharedApiResult<unknown> | null | undefined, successLabel: string) {
  return formatSharedApiStatus(result, successLabel);
}

export function sharedApiIsOk(result: SharedApiResult<unknown> | null | undefined) {
  return Boolean(result?.ok);
}

export function sharedApiIsIdle(result: SharedApiResult<unknown> | null | undefined) {
  return !result || (result.status == null && result.error == null && result.data == null);
}

export function sharedApiNotice(result: SharedApiResult<unknown> | null | undefined, successLabel: string) {
  const banner = sharedApiBanner(result, successLabel);
  return banner ?? { kind: "idle" as const, message: "Shared sync idle." };
}

export function sharedApiStatusTone(result: SharedApiResult<unknown> | null | undefined) {
  const kind = sharedApiStatusKind(result);
  return kind === "success" ? "emerald" : kind === "error" ? "amber" : "slate";
}

export function readResultOrNull<T>(result: SharedApiResult<T> | null | undefined) {
  return result?.data ?? null;
}export interface SharedResearchBundle {
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

export async function syncWorkspaceProfileWithStatus(company: WorkspaceCompanyRecord | null) {
  if (!company) return failureSharedApiResult("No company selected.");
  return postJsonWithStatus<Record<string, unknown>>("/api/research", {
    companyId: company.companyId,
    kind: "profile",
    issuer: company.issuer,
    notebook: company.notes,
    portfolio: company.portfolio,
  });
}

export async function syncWorkspaceFilingsWithStatus(companyId: string, filings: WorkspaceCompanyRecord["filings"]) {
  const latest = filings[0];
  if (!companyId || !latest) return failureSharedApiResult("No filing to sync.");
  return postJsonWithStatus<Record<string, unknown>>("/api/research", {
    companyId,
    kind: "filing",
    filing: latest,
  });
}

export async function syncWorkspaceJournalWithStatus(companyId: string, journal: WorkspaceResearchJournalEntry | null) {
  if (!companyId || !journal) return failureSharedApiResult("No journal entry to sync.");
  return postJsonWithStatus<Record<string, unknown>>("/api/research", {
    companyId,
    kind: "journal",
    journal,
  });
}

export async function syncWorkspacePortfolioWithStatus(companyId: string, portfolio: WorkspacePortfolioPlan) {
  if (!companyId) return failureSharedApiResult("No company selected.");
  return postJsonWithStatus<Record<string, unknown>>("/api/research", {
    companyId,
    kind: "portfolio",
    portfolio,
  });
}

export async function fetchSharedResearchBundleWithStatus(companyId: string) {
  if (!companyId) return failureSharedApiResult<SharedResearchBundle>("No company selected.");
  return getJsonWithStatus<SharedResearchBundle>(`/api/research?companyId=${encodeURIComponent(companyId)}`);
}

export async function fetchSharedComparisonRegistryWithStatus() {
  const result = await getJsonWithStatus<unknown>("/api/research?kind=comparison-registry");
  if (!result.ok || !result.data) return failureSharedApiResult("Shared comparison registry unavailable.", result.status);
  return successSharedApiResult(readCompanyRegistrySnapshot(result.data), result.status);
}

export async function syncSharedComparisonRegistryWithStatus(registry: CompanyRegistry) {
  if (!Object.keys(registry.companies).length) return failureSharedApiResult("No comparison companies to sync.");
  return postJsonWithStatus<Record<string, unknown>>("/api/research", {
    kind: "comparison-registry",
    comparisonRegistry: buildCompanyRegistrySnapshot(registry),
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

export interface AfesBlackboardOperationPayload {
  session: string;
  operation: "upsert-finding" | "append-debate-log" | "patch-code-state" | "patch-session-metadata" | "replace-snapshot";
  agentId?: string;
  findingKey?: string;
  finding?: Record<string, unknown>;
  entry?: Record<string, unknown>;
  code_state?: Record<string, unknown>;
  round?: number;
  agents_completed?: number;
  agents_pending?: number;
  consensus_score?: number;
  environment?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}

export async function fetchAfesBlackboard(session: string) {
  if (!session) return null;
  const payload = await getJson(`/api/blackboard?session=${encodeURIComponent(session)}`);
  if (!payload) return null;
  return readAfesBlackboardSnapshot(payload, session) as AfesBlackboardSnapshot;
}

export async function postAfesBlackboardOperation(payload: AfesBlackboardOperationPayload) {
  if (!payload?.session || !payload?.operation) return null;
  return postJson("/api/blackboard", payload);
}
