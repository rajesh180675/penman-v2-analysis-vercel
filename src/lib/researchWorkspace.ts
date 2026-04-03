import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { buildFilingRecord } from "../engine/filingRegistry";
import { buildIssuerMasterRecord } from "../engine/issuerRegistry";
import { ValuationCommandCenterOutput, ValuationSignalState } from "../engine/valuationCommandCenter";
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

export interface WorkspaceIssuerRecord {
  issuerId: string;
  legalName: string;
  primaryTicker: string | null;
  exchange: string | null;
  sector: string | null;
  subSector: string | null;
  businessModel: string;
  supportStatus: "supported" | "guarded" | "unsupported";
  source: "workspace" | "audit" | "manual";
  lastRefreshedAt: string;
}

export interface WorkspaceFilingRecord {
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

export interface WorkspaceValuationSnapshot {
  id: string;
  runId: string | null;
  recordedAt: string;
  asOf: string | null;
  marketPrice: number | null;
  signalState: ValuationSignalState;
  signalLabel: string;
  confidenceState: AnalysisStatusSummary["status"] | "unknown";
  opportunityScore: number | null;
  qualityScore: number | null;
  expectedCagrStress: number | null;
  expectedCagrBase: number | null;
  stressUpsidePct: number | null;
  baseUpsidePct: number | null;
  requiredMarginOfSafetyPct: number | null;
  convictionBucket: string | null;
  sectorTemplate: string | null;
  thesis: string;
  reverseDcfSummary: string;
  marketSymbol: string | null;
  marketFreshness?: string | null;
  marketSourceSummary?: string | null;
  livePriceAsOf?: string | null;
  liveRateAsOf?: string | null;
  valuationAnchorPeriod?: string | null;
  latestReportedPeriod?: string | null;
  persistenceScore?: number | null;
  marginDurabilityScore?: number | null;
  workingCapitalDisciplineScore?: number | null;
  businessModelEvidence?: string[] | null;
}

export interface WorkspaceSignalHistoryEntry {
  id: string;
  recordedAt: string;
  runId: string | null;
  state: ValuationSignalState;
  label: string;
  summary: string;
  confidenceState: AnalysisStatusSummary["status"] | "unknown";
  expectedCagrStress: number | null;
  marketPrice: number | null;
  opportunityScore: number | null;
  convictionBucket: string | null;
  marketFreshness?: string | null;
  valuationAnchorPeriod?: string | null;
}

export interface WorkspaceResearchJournalEntry {
  id: string;
  recordedAt: string;
  kind: "note" | "buy" | "sell" | "review" | "post-mortem";
  title: string;
  body: string;
  relatedRunId: string | null;
}

export interface WorkspacePortfolioPlan {
  sizingBucket: "research-only" | "starter" | "accumulate" | "core" | "aggressive";
  targetWeightPct: number | null;
  maxWeightPct: number | null;
  currentWeightPct: number | null;
  riskBudgetNote: string;
  thesisOverlap: string;
  exitRule: string;
  updatedAt: string | null;
}

export interface WorkspaceCompanyRecord {
  companyId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  issuer: WorkspaceIssuerRecord | null;
  notes: ResearchNotebook;
  runs: WorkspaceRunReference[];
  filings: WorkspaceFilingRecord[];
  analysisHistory: WorkspaceAnalysisSnapshot[];
  valuations: WorkspaceValuationSnapshot[];
  signalHistory: WorkspaceSignalHistoryEntry[];
  journal: WorkspaceResearchJournalEntry[];
  portfolio: WorkspacePortfolioPlan;
}

const STORAGE_KEY = "penman.research.workspace.v2";

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

function defaultPortfolio(): WorkspacePortfolioPlan {
  return {
    sizingBucket: "research-only",
    targetWeightPct: null,
    maxWeightPct: null,
    currentWeightPct: null,
    riskBudgetNote: "",
    thesisOverlap: "",
    exitRule: "",
    updatedAt: null,
  };
}

function readWorkspaceMap(): Record<string, WorkspaceCompanyRecord> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as Record<string, WorkspaceCompanyRecord> : {};
    }
  } catch {
    // Fall through to the legacy key.
  }

  try {
    const legacyRaw = window.localStorage.getItem("penman.research.workspace.v1");
    if (!legacyRaw) return {};
    const parsed = JSON.parse(legacyRaw);
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
  const existing = companies[companyId] as Partial<WorkspaceCompanyRecord> | undefined;
  if (existing) {
    return {
      companyId,
      label: label || existing.label || companyId,
      createdAt: existing.createdAt || nowIso(),
      lastSeenAt: nowIso(),
      issuer: existing.issuer ?? null,
      notes: existing.notes ?? defaultNotebook(),
      runs: existing.runs ?? [],
      filings: existing.filings ?? [],
      analysisHistory: existing.analysisHistory ?? [],
      valuations: existing.valuations ?? [],
      signalHistory: existing.signalHistory ?? [],
      journal: existing.journal ?? [],
      portfolio: existing.portfolio ?? defaultPortfolio(),
    } satisfies WorkspaceCompanyRecord;
  }

  return {
    companyId,
    label: label || companyId,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    issuer: null,
    notes: defaultNotebook(),
    runs: [],
    filings: [],
    analysisHistory: [],
    valuations: [],
    signalHistory: [],
    journal: [],
    portfolio: defaultPortfolio(),
  } satisfies WorkspaceCompanyRecord;
}

function upsertCompany(record: WorkspaceCompanyRecord) {
  const companies = readWorkspaceMap();
  companies[record.companyId] = record;
  writeWorkspaceMap(companies);
}

function inferSizingBucket(signalState: ValuationSignalState) {
  if (signalState === "screaming-buy") return "aggressive";
  if (signalState === "high-conviction") return "core";
  if (signalState === "interesting") return "accumulate";
  return "research-only";
}

export function listWorkspaceCompanies() {
  return Object.values(readWorkspaceMap()).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
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
    runs: nextRuns.slice(0, 30),
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
  const companyId = auditMeta?.companyId ?? rawData?.[0]?.company_id ?? config.ticker ?? null;
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

  const issuer = buildIssuerMasterRecord({
    companyId,
    label: record.label,
    rawData,
    config,
    analysisStatus,
    existing: record.issuer,
  });

  const filing = buildFilingRecord({
    rawData,
    recastData,
    analysisStatus,
    auditMeta,
  });
  const nextFilings = filing
    ? [filing, ...record.filings.filter((item) => item.filingId !== filing.filingId)].slice(0, 40)
    : record.filings;

  upsertCompany({
    ...record,
    issuer,
    filings: nextFilings,
    analysisHistory: nextHistory.slice(0, 60),
    lastSeenAt: nowIso(),
  });

  if (auditMeta) {
    rememberWorkspaceRun(auditMeta, {
      latestPeriod,
      label: companyId,
    });
  }
}

export function rememberWorkspaceValuation(params: {
  companyId: string;
  commandCenter: ValuationCommandCenterOutput;
  marketSymbol?: string | null;
  runId?: string | null;
}) {
  const { companyId, commandCenter, marketSymbol, runId } = params;
  if (!companyId) return;
  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, companyId, companyId);
  const timestamp = nowIso();

  const valuationSnapshot: WorkspaceValuationSnapshot = {
    id: `${runId ?? "workspace"}:${commandCenter.asOf ?? timestamp}:${commandCenter.signal.state}`,
    runId: runId ?? null,
    recordedAt: timestamp,
    asOf: commandCenter.asOf,
    marketPrice: commandCenter.marketPrice,
    signalState: commandCenter.signal.state,
    signalLabel: commandCenter.signal.label,
    confidenceState: commandCenter.signal.confidenceState,
    opportunityScore: commandCenter.opportunity.opportunityScore,
    qualityScore: commandCenter.opportunity.qualityScore,
    expectedCagrStress: commandCenter.opportunity.expectedCagrStress,
    expectedCagrBase: commandCenter.opportunity.expectedCagrBase,
    stressUpsidePct: commandCenter.signal.stressUpsidePct,
    baseUpsidePct: commandCenter.signal.baseUpsidePct,
    requiredMarginOfSafetyPct: commandCenter.opportunity.requiredMarginOfSafetyPct,
    convictionBucket: commandCenter.opportunity.convictionBucket,
    sectorTemplate: commandCenter.sectorTemplate.label,
    thesis: commandCenter.opportunity.thesis,
    reverseDcfSummary: commandCenter.reverseDcf.expectationLabel,
    marketSymbol: marketSymbol ?? null,
    marketFreshness: commandCenter.marketContext.freshness,
    marketSourceSummary: commandCenter.marketContext.sourceSummary,
    livePriceAsOf: commandCenter.marketContext.livePriceAsOf,
    liveRateAsOf: commandCenter.marketContext.liveRateAsOf,
    valuationAnchorPeriod: commandCenter.marketContext.valuationAnchorPeriod,
    latestReportedPeriod: commandCenter.marketContext.latestReportedPeriod,
    persistenceScore: commandCenter.businessModel.persistenceScore,
    marginDurabilityScore: commandCenter.businessModel.marginDurabilityScore,
    workingCapitalDisciplineScore: commandCenter.businessModel.workingCapitalDisciplineScore,
    businessModelEvidence: commandCenter.businessModel.evidence,
  };

  const signalSnapshot: WorkspaceSignalHistoryEntry = {
    id: `${runId ?? "workspace"}:${commandCenter.asOf ?? timestamp}:${commandCenter.signal.label}`,
    recordedAt: timestamp,
    runId: runId ?? null,
    state: commandCenter.signal.state,
    label: commandCenter.signal.label,
    summary: commandCenter.signal.summary,
    confidenceState: commandCenter.signal.confidenceState,
    expectedCagrStress: commandCenter.signal.expectedCagrStress,
    marketPrice: commandCenter.marketPrice,
    opportunityScore: commandCenter.signal.opportunityScore,
    convictionBucket: commandCenter.signal.convictionBucket,
    marketFreshness: commandCenter.marketContext.freshness,
    valuationAnchorPeriod: commandCenter.marketContext.valuationAnchorPeriod,
  };

  const nextValuations = record.valuations.filter((item) => item.id !== valuationSnapshot.id);
  nextValuations.unshift(valuationSnapshot);

  const nextSignals = record.signalHistory.filter((item) => item.id !== signalSnapshot.id);
  nextSignals.unshift(signalSnapshot);

  const shouldAutoAdjustPortfolio = !record.portfolio.updatedAt || record.portfolio.sizingBucket === "research-only";
  const portfolio = shouldAutoAdjustPortfolio
    ? {
        ...record.portfolio,
        sizingBucket: inferSizingBucket(commandCenter.signal.state) as WorkspacePortfolioPlan["sizingBucket"],
        targetWeightPct:
          commandCenter.signal.state === "screaming-buy"
            ? 12
            : commandCenter.signal.state === "high-conviction"
              ? 8
              : commandCenter.signal.state === "interesting"
                ? 4
                : 1,
        maxWeightPct:
          commandCenter.signal.state === "screaming-buy"
            ? 18
            : commandCenter.signal.state === "high-conviction"
              ? 12
              : commandCenter.signal.state === "interesting"
                ? 6
                : 2,
        updatedAt: timestamp,
      }
    : record.portfolio;

  upsertCompany({
    ...record,
    valuations: nextValuations.slice(0, 80),
    signalHistory: nextSignals.slice(0, 120),
    portfolio,
    lastSeenAt: timestamp,
  });
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

export function updateWorkspacePortfolio(companyId: string, patch: Partial<WorkspacePortfolioPlan>) {
  if (!companyId) return;
  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, companyId, companyId);
  upsertCompany({
    ...record,
    portfolio: {
      ...record.portfolio,
      ...patch,
      updatedAt: nowIso(),
    },
    lastSeenAt: nowIso(),
  });
}

export function addWorkspaceJournalEntry(companyId: string, entry: Omit<WorkspaceResearchJournalEntry, "id" | "recordedAt">) {
  if (!companyId || !entry.title.trim() || !entry.body.trim()) return;
  const companies = readWorkspaceMap();
  const record = ensureCompanyRecord(companies, companyId, companyId);
  const nextJournal = record.journal.filter((item) => !(item.kind === entry.kind && item.title === entry.title && item.body === entry.body));
  nextJournal.unshift({
    ...entry,
    id: `${entry.kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: nowIso(),
  });
  upsertCompany({
    ...record,
    journal: nextJournal.slice(0, 120),
    lastSeenAt: nowIso(),
  });
}
