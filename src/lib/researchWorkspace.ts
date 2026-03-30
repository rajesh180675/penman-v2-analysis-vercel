import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { EngineConfig, RecastPeriod, RawPeriodData } from "../engine/types";
import { AuditSubmissionMeta } from "./audit";

export interface ResearchNotebook {
  businessSummary: string;
  thesis: string;
  variantView: string;
  keyDrivers: string;
  catalysts: string;
  risks: string;
  whatMustGoRight: string;
  whatBreaksThesis: string;
  watchLevel: "watch" | "researching" | "accumulate" | "high-conviction";
  positionPlan: string;
  nextCheck: string;
  updatedAt: string | null;
}

export interface WorkspaceRunReference {
  runId: string;
  sourceMode: AuditSubmissionMeta["sourceMode"];
  fileName: string | null;
  latestPeriod: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface WorkspaceAnalysisSnapshot {
  id: string;
  companyId: string;
  runId: string | null;
  sourceMode: AuditSubmissionMeta["sourceMode"] | "workspace";
  recordedAt: string;
  latestPeriod: string | null;
  periodCount: number;
  analysisStatus: AnalysisStatusSummary["status"] | "unknown";
  analysisLabel: string;
  qualityTier: string;
  valuationStatus: string;
  marketSymbol: string | null;
  sectorTemplate: string | null;
}

export interface WorkspaceCompanyRecord {
  companyId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  notes: ResearchNotebook;
  runs: WorkspaceRunReference[];
  analysisHistory: WorkspaceAnalysisSnapshot[];
}

const STORAGE_KEY = "penman.research.workspace.v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowIso() {
  return new Date().toISOString();
}

function defaultNotebook(): ResearchNotebook {
  return {
    businessSummary: "",
    thesis: "",
    variantView: "",
    keyDrivers: "",
    catalysts: "",
    risks: "",
    whatMustGoRight: "",
    whatBreaksThesis: "",
    watchLevel: "watch",
    positionPlan: "",
    nextCheck: "",
    updatedAt: null,
  };
}

function readWorkspaceMap(): Record<string, WorkspaceCompanyRecord> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, WorkspaceCompanyRecord> : {};
  } catch {
    return {};
  }
}

function writeWorkspaceMap(next: Record<string, WorkspaceCompanyRecord>) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Local workspace persistence should never block the app.
  }
}

function ensureCompanyRecord(
  companies: Record<string, WorkspaceCompanyRecord>,
  companyId: string,
  label?: string | null,
) {
  const existing = companies[companyId];
  if (existing) {
    return {
      ...existing,
      label: label || existing.label || companyId,
      lastSeenAt: nowIso(),
      notes: existing.notes ?? defaultNotebook(),
      runs: existing.runs ?? [],
      analysisHistory: existing.analysisHistory ?? [],
    } satisfies WorkspaceCompanyRecord;
  }

  return {
    companyId,
    label: label || companyId,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    notes: defaultNotebook(),
    runs: [],
    analysisHistory: [],
  } satisfies WorkspaceCompanyRecord;
}

function upsertCompany(record: WorkspaceCompanyRecord) {
  const companies = readWorkspaceMap();
  companies[record.companyId] = record;
  writeWorkspaceMap(companies);
}

export function listWorkspaceCompanies() {
  return Object.values(readWorkspaceMap())
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

export function getWorkspaceCompany(companyId: string) {
  const companies = readWorkspaceMap();
  return companies[companyId] ?? null;
}

export function rememberWorkspaceRun(meta: AuditSubmissionMeta, details?: {
  latestPeriod?: string | null;
  label?: string | null;
}) {
  if (!meta.companyId) return;
  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, meta.companyId, details?.label ?? meta.companyId);
  const nextRuns = record.runs.filter((item) => item.runId !== meta.runId);
  nextRuns.unshift({
    runId: meta.runId,
    sourceMode: meta.sourceMode,
    fileName: meta.fileName ?? null,
    latestPeriod: details?.latestPeriod ?? null,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
  });
  upsertCompany({
    ...record,
    runs: nextRuns.slice(0, 20),
    lastSeenAt: nowIso(),
  });
}

export function rememberWorkspaceAnalysis(params: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
}) {
  const { rawData, recastData, config, analysisStatus, auditMeta } = params;
  const companyId = auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null;
  if (!companyId) return;

  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, companyId, companyId);
  const latestPeriod = rawData?.[rawData.length - 1]?.period_end ?? recastData?.[recastData.length - 1]?.period_end ?? null;
  const snapshot: WorkspaceAnalysisSnapshot = {
    id: `${auditMeta?.runId ?? "workspace"}:${latestPeriod ?? "unknown"}:${analysisStatus?.status ?? "unknown"}`,
    companyId,
    runId: auditMeta?.runId ?? null,
    sourceMode: auditMeta?.sourceMode ?? "workspace",
    recordedAt: nowIso(),
    latestPeriod,
    periodCount: rawData?.length ?? recastData?.length ?? 0,
    analysisStatus: analysisStatus?.status ?? "unknown",
    analysisLabel: analysisStatus?.label ?? "Unknown",
    qualityTier: analysisStatus?.qualityTier ?? "Unknown",
    valuationStatus: analysisStatus?.valuationStatus ?? "unknown",
    marketSymbol: config.market_data_symbol ?? config.ticker ?? null,
    sectorTemplate: config.sector_template ?? null,
  };

  const nextHistory = record.analysisHistory.filter((item) => item.id !== snapshot.id);
  nextHistory.unshift(snapshot);

  upsertCompany({
    ...record,
    analysisHistory: nextHistory.slice(0, 40),
    lastSeenAt: nowIso(),
  });

  if (auditMeta) {
    rememberWorkspaceRun(auditMeta, {
      latestPeriod,
      label: companyId,
    });
  }
}

export function updateWorkspaceNotebook(companyId: string, patch: Partial<ResearchNotebook>) {
  if (!companyId) return;
  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, companyId, companyId);
  upsertCompany({
    ...record,
    notes: {
      ...record.notes,
      ...patch,
      updatedAt: nowIso(),
    },
    lastSeenAt: nowIso(),
  });
}
