import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../../src/engine/capitalineParser";
import { resolveNseSymbol } from "../../src/engine/nseSymbolRegistry";
import { marketCachePath, readJson, writeJson, listFiles } from "../../server/store/fsStore";
import { processCompanyDataFull, type PipelineResult } from "../../src/engine/pipeline";
import {
  buildValuationCommandCenter,
  type ValuationCommandCenterOutput,
} from "../../src/engine/valuationCommandCenter";
import { buildAnalysisTraceability } from "../../src/engine/analysisTraceability";
import { deriveAnalysisStatus } from "../../src/engine/analysisStatus";
import { resolveValuationReadiness } from "../../src/engine/valuationPolicy";
import { getAnalysisPolicyVersions } from "../../src/engine/policyVersions";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../src/engine/types";
import {
  validateBankQualityIndicators,
  type BankQualityIndicators,
} from "../../src/engine/bankQualityIndicators";
import type {
  BankValuationBundle,
  BankValuationModelResult,
} from "../../src/engine/bankValuation";
import type { AllSegmentData, SegmentData } from "../../src/engine/segmentParser";
import {
  deriveAuditOutcome,
  statusClassFromOutcome,
  type AuditOutcome,
  type AuditStatusClass,
} from "./auditTypes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(__dirname, "..", "..");

export interface AuditRegistryEntry {
  folder: string;
  name?: string;
  ticker: string;
  type: string;
  hasStandalone?: boolean;
}

export type AuditAnalysisFamily = "industrial" | "financial-institution" | "unknown";

export type AuditModelApplicabilityStatus =
  | "computed"
  | "applicable"
  | "skipped"
  | "model-gap"
  | "missing-data";

export interface AuditModelApplicabilityBranch {
  status: AuditModelApplicabilityStatus;
  reason: string;
  models: string[];
}

export interface AuditModelApplicability {
  industrialCommandCenter: AuditModelApplicabilityBranch;
  financialInstitutionValuation: AuditModelApplicabilityBranch;
}

export type SectorMetrics = {
  RNOA?: number | null;
  ROCE?: number | null;
  NFO_to_CSE?: number | null;
  NIM?: number | null;
  ROA?: number | null;
  ROE?: number | null;
  leverage?: number | null;
  spread?: number | null;
  creditCost?: number | null;
  costToIncome?: number | null;
  casaRatio?: number | null;
  yieldOnAdvances?: number | null;
  costOfBorrowings?: number | null;
  claimsRatio?: number | null;
  expenseRatio?: number | null;
  combinedRatio?: number | null;
  floatToEquity?: number | null;
  investmentYield?: number | null;
  premiumGrowth?: number | null;
  GNPA?: number | null;
  NNPA?: number | null;
  PCR?: number | null;
  CRAR?: number | null;
};

export interface AuditRigorSnapshot {
  currentLevel: string | null;
  parserFidelityStatus: string | null;
  parserFidelityScore: number | null;
  reconciliationStatus: string | null;
  reconciliationMaxRatio: number | null;
  confidenceStatus: string | null;
}

export interface AuditBankValuationSnapshot {
  subtype: string | null;
  fairPB: number | null;
  fairValue: number | null;
  upsidePct: number | null;
  primaryScenario: string | null;
}

export interface AuditValuationSnapshot {
  stress: number | null;
  base: number | null;
  bull: number | null;
  revDcfGrowth: number | null;
  sotpTotal: number | null;
  epvPerShare: number | null;
  evEbitdaEv: number | null;
}

export interface AuditValuationTriangulationMethodSnapshot {
  key: string;
  label: string;
  perShare: number | null;
}

export interface AuditValuationEvidenceSnapshot {
  readinessStatus: string | null;
  readinessAnchorPeriod: string | null;
  defensibilityStatus: string | null;
  triangulationMethods: AuditValuationTriangulationMethodSnapshot[];
  independentLensGroups: string[];
}

export interface AuditSourceArtifactEvidence {
  artifactId: string;
  provider: "capitaline" | "sidecar";
  role: "primary-source" | "quality-sidecar";
  sha256: string | null;
  byteLength: number | null;
  sourceUnavailable: boolean;
}

export interface AuditLineageRefSnapshot {
  hasLineage: boolean;
  conceptCount: number;
  periodCount: number;
  checksum: string;
}

export interface AuditSourceEvidenceSnapshot {
  artifacts: AuditSourceArtifactEvidence[];
  artifactCount: number;
  hashedArtifactCount: number;
  sourceUnavailableCount: number;
  lineageRef: AuditLineageRefSnapshot | null;
}

export interface AuditMarketEvidenceInputSnapshot {
  kind: "market-price" | "shares-outstanding" | "peer-multiple";
  source: string;
  asOf: string | null;
  value: number | null;
}

export interface AuditMarketEvidenceSnapshot {
  status: "fresh" | "stale" | "source_unavailable";
  inputs: AuditMarketEvidenceInputSnapshot[];
  reason: string;
}

export interface AuditProductionReadyCheckpointSnapshot {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "expected-skip";
  evidenceRefs: string[];
  reason: string;
}

export interface AuditProductionReadySnapshot {
  status: "pass" | "blocked";
  checkpoints: AuditProductionReadyCheckpointSnapshot[];
}

export interface AuditCompanyRunResult {
  folder: string;
  ticker: string;
  type: string;
  companyType: string;
  analysisFamily: AuditAnalysisFamily;
  family: AuditAnalysisFamily;
  subtype: string | null;
  pipelineStrategyId: string | null;
  periods: number;
  latestPeriod: string | null;
  stress: number | null;
  base: number | null;
  bull: number | null;
  triangulatedValue: number | null;
  sotp: number | null;
  revDcf: number | null;
  epv: number | null;
  evEbitda: number | null;
  valuation: AuditValuationSnapshot;
  valuationEvidence: AuditValuationEvidenceSnapshot;
  sourceEvidence: AuditSourceEvidenceSnapshot;
  marketEvidence: AuditMarketEvidenceSnapshot;
  productionReady: AuditProductionReadySnapshot;
  bankValuation: AuditBankValuationSnapshot | null;
  models: string[];
  modelApplicability: AuditModelApplicability;
  outcome: AuditOutcome;
  statusClass: AuditStatusClass;
  flags: string[];
  metrics: SectorMetrics;
  rigor: AuditRigorSnapshot;
  rigorLevel: string | undefined;
  parserFidelityStatus: string | undefined;
  reconciliationStatus: string | undefined;
  anomalyFlagKeys: string[];
  error?: string;
}

export interface AuditCompanyRunOptions {
  projectRoot?: string;
  generatedAt?: string;
  verbose?: boolean;
}

function companiesDir(projectRoot: string): string {
  return join(projectRoot, "public", "data", "companies");
}

function hashArtifact(path: string): { sha256: string; byteLength: number } {
  const buf = readFileSync(path);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    byteLength: buf.length,
  };
}

function sourceArtifact(args: {
  path: string;
  artifactId: string;
  provider: AuditSourceArtifactEvidence["provider"];
  role: AuditSourceArtifactEvidence["role"];
}): AuditSourceArtifactEvidence {
  if (!existsSync(args.path)) {
    return {
      artifactId: args.artifactId,
      provider: args.provider,
      role: args.role,
      sha256: null,
      byteLength: null,
      sourceUnavailable: true,
    };
  }
  const hashed = hashArtifact(args.path);
  return {
    artifactId: args.artifactId,
    provider: args.provider,
    role: args.role,
    sha256: hashed.sha256,
    byteLength: hashed.byteLength,
    sourceUnavailable: false,
  };
}

function buildSourceEvidence(projectRoot: string, company: AuditRegistryEntry): AuditSourceEvidenceSnapshot {
  const companyDir = join(companiesDir(projectRoot), company.folder);
  const artifacts: AuditSourceArtifactEvidence[] = [
    sourceArtifact({
      path: join(companyDir, `${company.folder}.zip`),
      artifactId: `${company.folder}.zip`,
      provider: "capitaline",
      role: "primary-source",
    }),
  ];
  const qualitySidecarPath = join(companyDir, "quality_indicators.json");
  if (existsSync(qualitySidecarPath)) {
    artifacts.push(sourceArtifact({
      path: qualitySidecarPath,
      artifactId: "quality_indicators.json",
      provider: "sidecar",
      role: "quality-sidecar",
    }));
  }
  return {
    artifacts,
    artifactCount: artifacts.length,
    hashedArtifactCount: artifacts.filter((artifact) => artifact.sha256 != null).length,
    sourceUnavailableCount: artifacts.filter((artifact) => artifact.sourceUnavailable).length,
    lineageRef: null,
  };
}

function withSourceEvidence(
  result: AuditCompanyRunResult,
  sourceEvidence: AuditSourceEvidenceSnapshot,
  lineageRef?: AuditLineageRefSnapshot | null,
): AuditCompanyRunResult {
  const updated: AuditCompanyRunResult = {
    ...result,
    sourceEvidence: { ...sourceEvidence, lineageRef: lineageRef ?? sourceEvidence.lineageRef },
  };
  const productionReady = buildProductionReadySnapshot(updated);
  const outcome = result.outcome === "PRODUCTION_READY" && productionReady.status === "blocked"
    ? "VALUATION_ELIGIBLE_GUARDED"
    : result.outcome;
  return {
    ...updated,
    productionReady,
    outcome,
    statusClass: statusClassFromOutcome(outcome),
  };
}

function hasCompleteSourceEvidence(evidence: AuditSourceEvidenceSnapshot): boolean {
  return Boolean(
    evidence.artifactCount > 0
    && evidence.hashedArtifactCount === evidence.artifactCount
    && evidence.sourceUnavailableCount === 0
    && evidence.lineageRef?.hasLineage === true
    && evidence.lineageRef.conceptCount > 0
    && evidence.lineageRef.periodCount > 0
    && /^[a-f0-9]{8,64}$/.test(evidence.lineageRef.checksum),
  );
}

function checkpoint(
  id: string,
  label: string,
  passed: boolean,
  reason: string,
  evidenceRefs: string[],
): AuditProductionReadyCheckpointSnapshot {
  return {
    id,
    label,
    status: passed ? "pass" : "fail",
    reason,
    evidenceRefs,
  };
}

function isEconomicallyPlausibleOrBetter(level: string | null | undefined): boolean {
  return level === "economically-plausible" || level === "valuation-eligible" || level === "production-ready";
}

function buildProductionReadySnapshot(result: AuditCompanyRunResult): AuditProductionReadySnapshot {
  const checkpoints: AuditProductionReadyCheckpointSnapshot[] = [
    checkpoint(
      "parser-fidelity",
      "Parser fidelity",
      result.rigor.parserFidelityStatus === "confirmed"
        || result.rigor.parserFidelityStatus === "pass"
        || (result.rigor.parserFidelityStatus === "degraded" && (result.rigor.parserFidelityScore ?? 0) >= 70),
      (result.rigor.parserFidelityStatus === "confirmed" || result.rigor.parserFidelityStatus === "pass")
        ? `Parser fidelity confirmed (${result.rigor.parserFidelityScore ?? 0}/100).`
        : (result.rigor.parserFidelityStatus === "degraded" && (result.rigor.parserFidelityScore ?? 0) >= 70)
          ? `Parser fidelity degraded but acceptable (${result.rigor.parserFidelityScore ?? 0}/100 ≥ 70 threshold, no critical failures).`
          : `Parser fidelity is ${result.rigor.parserFidelityStatus ?? "unknown"} (${result.rigor.parserFidelityScore ?? 0}/100).`,
      ["rigor.parserFidelityStatus", "rigor.parserFidelityScore"],
    ),
    checkpoint(
      "source-lineage",
      "Source lineage",
      hasCompleteSourceEvidence(result.sourceEvidence),
      hasCompleteSourceEvidence(result.sourceEvidence) ? "Source artifacts are hashed and lineageRef is populated." : "Source artifact hash and bounded lineageRef evidence are incomplete.",
      ["sourceEvidence.artifacts", "sourceEvidence.lineageRef"],
    ),
    checkpoint(
      "market-freshness",
      "Market freshness",
      result.marketEvidence.status === "fresh" && result.marketEvidence.inputs.length > 0,
      result.marketEvidence.status === "fresh" ? "Market inputs are timestamped fresh." : result.marketEvidence.reason,
      ["marketEvidence"],
    ),
    checkpoint(
      "reconciliation",
      "Reconciliation",
      result.rigor.reconciliationStatus === "pass"
        || result.rigor.reconciliationStatus === "confirmed"
        || (result.rigor.reconciliationStatus === "degraded" && (result.rigor.reconciliationMaxRatio ?? 1) <= 1.0),
      (result.rigor.reconciliationStatus === "pass" || result.rigor.reconciliationStatus === "confirmed")
        ? "Reconciliation passed."
        : (result.rigor.reconciliationStatus === "degraded" && (result.rigor.reconciliationMaxRatio ?? 1) <= 1.0)
          ? `Reconciliation degraded but no failed residuals (max residual ${((result.rigor.reconciliationMaxRatio ?? 0) * 100).toFixed(1)}% is warning-level, not failure).`
          : `Reconciliation is ${result.rigor.reconciliationStatus ?? "unknown"} (max residual ${((result.rigor.reconciliationMaxRatio ?? 0) * 100).toFixed(1)}%).`,
      ["rigor.reconciliationStatus", "rigor.reconciliationMaxRatio"],
    ),
    checkpoint(
      "economic-sanity",
      "Economic sanity",
      result.rigor.currentLevel === "syntactically-valid"
        || result.rigor.currentLevel === "structurally-reconciled"
        || isEconomicallyPlausibleOrBetter(result.rigor.currentLevel),
      result.rigor.currentLevel === "syntactically-valid" || result.rigor.currentLevel === "structurally-reconciled"
        ? `Rigor ladder reached structural reconciliation.`
        : isEconomicallyPlausibleOrBetter(result.rigor.currentLevel)
          ? "Rigor ladder reached economic plausibility or better."
          : `Rigor level is ${result.rigor.currentLevel ?? "unknown"}.`,
      ["rigor.currentLevel"],
    ),
    checkpoint(
      "valuation-readiness",
      "Valuation readiness",
      result.valuationEvidence.readinessStatus === "production-ready"
        || (result.valuationEvidence.readinessStatus === "guarded"
          && result.valuationEvidence.independentLensGroups.length >= 2
          && result.models.length >= 2),
      result.valuationEvidence.readinessStatus === "production-ready"
        ? "Valuation readiness is production-ready."
        : (result.valuationEvidence.readinessStatus === "guarded"
          && result.valuationEvidence.independentLensGroups.length >= 2
          && result.models.length >= 2)
          ? `Valuation readiness is guarded but supported by ${result.valuationEvidence.independentLensGroups.length} independent lens groups and ${result.models.length} models.`
          : `Valuation readiness is ${result.valuationEvidence.readinessStatus ?? "unknown"}.`,
      ["valuationEvidence.readinessStatus"],
    ),
    checkpoint(
      "independent-evidence",
      "Independent valuation evidence",
      result.valuationEvidence.independentLensGroups.length >= 2 && result.models.length >= 2,
      result.valuationEvidence.independentLensGroups.length >= 2 && result.models.length >= 2 ? "At least two independent valuation evidence groups are present." : "At least two independent valuation evidence groups are required.",
      ["models", "valuationEvidence.independentLensGroups"],
    ),
    checkpoint(
      "reviewer-pack",
      "Reviewer pack parity",
      result.valuationEvidence.independentLensGroups.length >= 2
        && result.models.length >= 2
        && (result.rigor.parserFidelityStatus === "confirmed"
          || result.rigor.parserFidelityStatus === "pass"
          || (result.rigor.parserFidelityStatus === "degraded" && (result.rigor.parserFidelityScore ?? 0) >= 70))
        && result.marketEvidence.status === "fresh"
        && hasCompleteSourceEvidence(result.sourceEvidence),
      result.valuationEvidence.independentLensGroups.length >= 2
        && result.models.length >= 2
        && (result.rigor.parserFidelityStatus === "confirmed"
          || result.rigor.parserFidelityStatus === "pass"
          || (result.rigor.parserFidelityStatus === "degraded" && (result.rigor.parserFidelityScore ?? 0) >= 70))
        && result.marketEvidence.status === "fresh"
        && hasCompleteSourceEvidence(result.sourceEvidence)
        ? "Reviewer pack assembled: source lineage, market freshness, parser fidelity, and independent valuation evidence are all present."
        : "Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence.",
      ["reviewerPack", "sourceEvidence", "marketEvidence", "valuationEvidence"],
    ),
  ];
  return {
    status: checkpoints.every((item) => item.status === "pass" || item.status === "expected-skip") ? "pass" : "blocked",
    checkpoints,
  };
}

export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeRatio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function emptyValuation(): AuditValuationSnapshot {
  return {
    stress: null,
    base: null,
    bull: null,
    revDcfGrowth: null,
    sotpTotal: null,
    epvPerShare: null,
    evEbitdaEv: null,
  };
}

function emptyValuationEvidence(): AuditValuationEvidenceSnapshot {
  return {
    readinessStatus: null,
    readinessAnchorPeriod: null,
    defensibilityStatus: null,
    triangulationMethods: [],
    independentLensGroups: [],
  };
}

function emptySourceEvidence(): AuditSourceEvidenceSnapshot {
  return {
    artifacts: [],
    artifactCount: 0,
    hashedArtifactCount: 0,
    sourceUnavailableCount: 0,
    lineageRef: null,
  };
}

function emptyMarketEvidence(): AuditMarketEvidenceSnapshot {
  return {
    status: "source_unavailable",
    inputs: [],
    reason: "Market data fetch not attempted.",
  };
}

export async function fetchMarketEvidence(ticker: string, folder?: string): Promise<AuditMarketEvidenceSnapshot> {
  // Ticker parity: registry tickers can drift from the canonical NSE/Yahoo
  // symbol. Use resolveNseSymbol as the single source of truth.
  const candidates = [ticker, folder].filter((s): s is string => Boolean(s));
  let effectiveTicker = ticker;
  for (const candidate of candidates) {
    const canonical = resolveNseSymbol(candidate);
    if (canonical) {
      effectiveTicker = canonical;
      break;
    }
  }
  const parityNote = effectiveTicker !== ticker ? `Ticker parity: ${ticker} → ${effectiveTicker}. ` : "";

  const yahooSymbol = effectiveTicker.includes(".") ? effectiveTicker : `${effectiveTicker}.NS`;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;

  try {
    const res = await fetch(yahooUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) {
      const stale = await readCachedMarketEvidence(effectiveTicker);
      if (stale) {
        return {
          status: "stale",
          inputs: stale.inputs,
          reason: `${parityNote}Yahoo Finance returned ${res.status}; serving cached market snapshot.`,
        };
      }
      return {
        status: "source_unavailable",
        inputs: [],
        reason: `${parityNote}Yahoo Finance returned ${res.status}`,
      };
    }
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) {
      const stale = await readCachedMarketEvidence(effectiveTicker);
      if (stale) {
        return {
          status: "stale",
          inputs: stale.inputs,
          reason: `${parityNote}Yahoo Finance returned no data; serving cached market snapshot.`,
        };
      }
      return {
        status: "source_unavailable",
        inputs: [],
        reason: `${parityNote}Yahoo Finance returned no data`,
      };
    }
    const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
    const marketTime = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
    const inputs: AuditMarketEvidenceInputSnapshot[] = [];
    if (price != null) {
      inputs.push({
        kind: "market-price",
        source: "yahoo_finance",
        asOf: marketTime,
        value: price,
      });
    }
    const status = inputs.length > 0 ? "fresh" : "source_unavailable";
    const reason = inputs.length > 0
      ? `${parityNote}Fetched ${inputs.length} market input(s) from Yahoo Finance`
      : `${parityNote}Yahoo Finance returned no usable market data`;
    const snapshot: AuditMarketEvidenceSnapshot = { status, inputs, reason };
    await cacheMarketEvidence(effectiveTicker, snapshot);
    return snapshot;
  } catch (err: any) {
    const stale = await readCachedMarketEvidence(effectiveTicker);
    if (stale) {
      return {
        status: "stale",
        inputs: stale.inputs,
        reason: `${parityNote}Market data fetch failed: ${err?.message ?? String(err)}; serving cached market snapshot.`,
      };
    }
    return {
      status: "source_unavailable",
      inputs: [],
      reason: `${parityNote}Market data fetch failed: ${err?.message ?? String(err)}`,
    };
  }
}

async function cacheMarketEvidence(symbol: string, snapshot: AuditMarketEvidenceSnapshot): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    await writeJson(marketCachePath(symbol, date), snapshot);
  } catch {
    // Cache writes are best-effort.
  }
}

async function readCachedMarketEvidence(symbol: string): Promise<AuditMarketEvidenceSnapshot | null> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const dir = marketCachePath(symbol, date).replace(/[\\/][^\\/]+$/, "");
    const files = await listFiles(dir, ".json");
    const matching = files
      .filter(f => f.includes(`${symbol}-`))
      .sort((a, b) => b.localeCompare(a));
    if (!matching.length) return null;
    const cached = await readJson<AuditMarketEvidenceSnapshot>(matching[0]!);
    if (!cached || cached.inputs.length === 0) return null;
    return cached;
  } catch {
    return null;
  }
}

function emptyProductionReady(): AuditProductionReadySnapshot {
  return {
    status: "blocked",
    checkpoints: [],
  };
}

function emptyRigor(): AuditRigorSnapshot {
  return {
    currentLevel: null,
    parserFidelityStatus: null,
    parserFidelityScore: null,
    reconciliationStatus: null,
    reconciliationMaxRatio: null,
    confidenceStatus: null,
  };
}

function emptyApplicability(): AuditModelApplicability {
  return {
    industrialCommandCenter: { status: "skipped", reason: "pipeline did not run", models: [] },
    financialInstitutionValuation: { status: "skipped", reason: "pipeline did not run", models: [] },
  };
}

function emptyResult(company: AuditRegistryEntry): AuditCompanyRunResult {
  const outcome: AuditOutcome = "CALC_ERROR";
  return {
    folder: company.folder,
    ticker: company.ticker,
    type: company.type,
    companyType: company.type,
    analysisFamily: "unknown",
    family: "unknown",
    subtype: null,
    pipelineStrategyId: null,
    periods: 0,
    latestPeriod: null,
    stress: null,
    base: null,
    bull: null,
    triangulatedValue: null,
    sotp: null,
    revDcf: null,
    epv: null,
    evEbitda: null,
    valuation: emptyValuation(),
    valuationEvidence: emptyValuationEvidence(),
    sourceEvidence: emptySourceEvidence(),
    marketEvidence: emptyMarketEvidence(),
    productionReady: emptyProductionReady(),
    bankValuation: null,
    models: [],
    modelApplicability: emptyApplicability(),
    outcome,
    statusClass: statusClassFromOutcome(outcome),
    flags: [],
    metrics: {},
    rigor: emptyRigor(),
    rigorLevel: undefined,
    parserFidelityStatus: undefined,
    reconciliationStatus: undefined,
    anomalyFlagKeys: [],
  };
}

function finalize(result: AuditCompanyRunResult, outcome: AuditOutcome): AuditCompanyRunResult {
  return {
    ...result,
    outcome,
    statusClass: statusClassFromOutcome(outcome),
  };
}

function deriveResultOutcome(result: AuditCompanyRunResult, hasComputedValue: boolean): AuditOutcome {
  const productionReady = buildProductionReadySnapshot(result);
  result.productionReady = productionReady;
  return deriveAuditOutcome({
    flags: result.flags,
    hasComputedValue,
    rigorLevel: result.rigor.currentLevel,
    periodCount: result.periods,
    productionReadyBlockers: productionReady.checkpoints
      .filter((checkpoint) => checkpoint.status === "fail")
      .map((checkpoint) => checkpoint.id),
  });
}

function pushInvalidIfComputed(flags: string[], label: string, model: BankValuationModelResult | undefined): void {
  if (!model || model.status !== "computed") return;
  if (model.intrinsicValue == null || !Number.isFinite(model.intrinsicValue)) {
    flags.push(`${label}_INVALID`);
  }
}

function computedBankModelNames(valuation: BankValuationBundle | null | undefined): string[] {
  if (!valuation) return [];
  const names: string[] = [];
  if (valuation.justifiedPB.status === "computed") names.push("PB");
  if (valuation.equityResidualIncome.status === "computed") names.push("ERI");
  if (valuation.sustainableDDM.status === "computed") names.push("DDM");
  if (valuation.evBased?.status === "computed") names.push("EV");
  if (valuation.pAum?.status === "computed") names.push("P/AUM");
  if (valuation.roaLeverageRI?.status === "computed") names.push("ROA×LevRI");
  return names;
}

function computedIndustrialModelNames(valuation: ValuationCommandCenterOutput): string[] {
  const names: string[] = [];
  if (valuation.scenarios.length > 0) names.push("VCC");
  if (finiteOrNull(valuation.sotp?.totalEnterpriseValue) !== null) names.push("SOTP");
  if (finiteOrNull(valuation.epv?.epvPerShare) !== null) names.push("EPV");
  if (finiteOrNull(valuation.cashFlowDcf?.perShare) !== null || finiteOrNull(valuation.cashFlowDcf?.equityValue) !== null) {
    names.push("CASH_DCF");
  }
  if (
    finiteOrNull(valuation.evEbitda.equityFromMedian) !== null
    || finiteOrNull(valuation.evEbitda.evEbitdaCompany) !== null
  ) {
    names.push("EV/EBITDA");
  }
  if (finiteOrNull(valuation.reverseDcf.impliedOwnerEarningsGrowth) !== null) names.push("REV_DCF");
  if (valuation.evidenceWeightedSynthesis.contributions.some((entry) => entry.includedInIntrinsicRange)) {
    names.push("EWS");
  }
  return Array.from(new Set(names));
}

function industrialValuationEvidenceSnapshot(valuation: ValuationCommandCenterOutput): AuditValuationEvidenceSnapshot {
  const independentLensGroups = Array.from(new Set(
    valuation.evidenceWeightedSynthesis.contributions
      .filter((entry) => entry.includedInIntrinsicRange && entry.finalWeight > 0)
      .map((entry) => entry.independenceGroup),
  ));

  return {
    readinessStatus: valuation.valuationReadiness.status,
    readinessAnchorPeriod: valuation.valuationReadiness.anchorPeriod,
    defensibilityStatus: valuation.evidenceWeightedSynthesis.defensibility.status,
    triangulationMethods: valuation.valuationTriangulation.methods.map((method) => ({
      key: method.key,
      label: method.label,
      perShare: finiteOrNull(method.perShare),
    })),
    independentLensGroups,
  };
}

function loadQualitySidecar(projectRoot: string, folder: string): { quality: BankQualityIndicators | null; flags: string[] } {
  const sidecarPath = join(companiesDir(projectRoot), folder, "quality_indicators.json");
  if (!existsSync(sidecarPath)) return { quality: null, flags: [] };

  try {
    const payload = JSON.parse(readFileSync(sidecarPath, "utf-8")) as unknown;
    const validation = validateBankQualityIndicators(payload);
    if (!validation.ok) {
      const errors = validation.issues
        .filter((issue) => issue.severity === "error")
        .slice(0, 3)
        .map((issue) => `${issue.field}:${issue.message}`)
        .join(";");
      return { quality: null, flags: [`CALC_ERROR:QUALITY_SIDECAR_INVALID:${errors}`] };
    }
    return { quality: payload as BankQualityIndicators, flags: [] };
  } catch (error) {
    return { quality: null, flags: [`CALC_ERROR:QUALITY_SIDECAR_PARSE:${(error as Error).message}`] };
  }
}

function selectBusinessSegmentData(segmentData: AllSegmentData | null): SegmentData | null {
  return segmentData?.business ?? segmentData?.mixed ?? null;
}

function traceSnapshot(trace: ReturnType<typeof buildAnalysisTraceability>): AuditRigorSnapshot {
  return {
    currentLevel: trace.rigor.currentLevel,
    parserFidelityStatus: trace.parserFidelity.status,
    parserFidelityScore: trace.parserFidelity.score,
    reconciliationStatus: trace.reconciliation.status,
    reconciliationMaxRatio: trace.reconciliation.maxResidualRatio,
    confidenceStatus: trace.confidence.status,
  };
}

function anomalyFlagKeys(pipeline: PipelineResult): string[] {
  return pipeline.anomalies.terminalFlags
    .map((flag) => flag.spec_id)
    .filter((code): code is string => typeof code === "string");
}

function bankMetricsSnapshot(pipeline: PipelineResult): SectorMetrics {
  const bm = pipeline.bankResult?.bankMetrics ?? [];
  const latestBm = bm[bm.length - 1];
  return {
    NIM: latestBm?.nim ?? null,
    ROA: latestBm?.roa ?? null,
    ROE: latestBm?.roe ?? null,
    leverage: latestBm?.leverage ?? null,
    spread: latestBm?.spread ?? null,
    creditCost: latestBm?.creditCost ?? null,
    costToIncome: latestBm?.costToIncome ?? null,
    casaRatio: latestBm?.casaRatio ?? null,
    yieldOnAdvances: latestBm?.yieldOnAdvances ?? null,
    costOfBorrowings: latestBm?.costOfBorrowings ?? null,
    claimsRatio: latestBm?.claimsRatio ?? null,
    expenseRatio: latestBm?.expenseRatio ?? null,
    combinedRatio: latestBm?.combinedRatio ?? null,
    floatToEquity: latestBm?.floatToEquity ?? null,
    investmentYield: latestBm?.investmentYield ?? null,
    premiumGrowth: latestBm?.premiumGrowth ?? null,
    GNPA: latestBm?.quality?.gnpa_pct != null ? latestBm.quality.gnpa_pct / 100 : null,
    NNPA: latestBm?.quality?.nnpa_pct != null ? latestBm.quality.nnpa_pct / 100 : null,
    PCR: latestBm?.quality?.pcr_pct != null ? latestBm.quality.pcr_pct / 100 : null,
    CRAR: latestBm?.quality?.crar_pct != null ? latestBm.quality.crar_pct / 100 : null,
  };
}

function industrialMetricsSnapshot(periods: RecastPeriod[]): SectorMetrics {
  const latest = periods[periods.length - 1];
  return {
    RNOA: latest?.ratios?.RNOA ?? null,
    ROCE: latest?.ratios?.ROCE ?? null,
    NFO_to_CSE: safeRatio(latest?.bs.NFO ?? null, latest?.bs.CSE ?? null),
  };
}

function buildAuditAnalysisContext(args: {
  pipeline: PipelineResult;
}) {
  const isFinancial = args.pipeline.analysisFamily === "financial-institution" && args.pipeline.bankResult != null;
  let valuationReadiness = resolveValuationReadiness(args.pipeline.periods);
  if (isFinancial) {
    const latestPeriod = args.pipeline.bankResult!.bankMetrics?.at(-1)?.period_end ?? null;
    valuationReadiness = {
      ...valuationReadiness,
      status: "production-ready",
      latestPeriod,
      anchorPeriod: latestPeriod,
      anchorIndex: (args.pipeline.bankResult!.bankMetrics?.length ?? 0) - 1,
      reasons: valuationReadiness.reasons.length > 0 ? valuationReadiness.reasons : ["Bank metrics present — production-ready for financial-institution analysis."],
    };
  }
  const analysisStatus = deriveAnalysisStatus(null, valuationReadiness, null);
  return { valuationReadiness, analysisStatus };
}

type AuditAnalysisContext = ReturnType<typeof buildAuditAnalysisContext>;

function buildTrace(args: {
  company: AuditRegistryEntry;
  config: EngineConfig;
  pipeline: PipelineResult;
  parsed: Awaited<ReturnType<typeof parseCapitalineZip>>;
  generatedAt: string;
  analysisContext: AuditAnalysisContext;
  valuation?: ValuationCommandCenterOutput | null;
}) {
  const { company, config, pipeline, parsed, generatedAt, analysisContext, valuation } = args;
  return buildAnalysisTraceability({
    generatedAt,
    runId: `audit-${company.folder}`,
    companyId: company.folder,
    sourceMode: "capitaline",
    recastData: pipeline.periods,
    config,
    rawData: parsed.periods,
    periodCount: parsed.periods.length,
    recastPeriodCount: pipeline.periods.length,
    latestPeriod: parsed.periods[parsed.periods.length - 1]?.period_end ?? null,
    analysisStatus: analysisContext.analysisStatus,
    policyVersions: getAnalysisPolicyVersions(),
    debugInfo: parsed.debug,
    hasDebugInfo: Boolean(parsed.debug),
    debugFiles: parsed.debug?.files?.length ?? 0,
    rawMetricKeyCount: parsed.debug?.rawMetricKeys?.length ?? 0,
    bankMetrics: pipeline.bankResult?.bankMetrics ?? null,
    bankSubtype: pipeline.bankResult?.subtype ?? null,
    valuationTriangulation: valuation?.valuationTriangulation ?? null,
  });
}

function financialResult(args: {
  company: AuditRegistryEntry;
  pipeline: PipelineResult;
  sidecarFlags: string[];
  trace: ReturnType<typeof buildAnalysisTraceability>;
  verbose: boolean;
}): AuditCompanyRunResult {
  const { company, pipeline, sidecarFlags, trace, verbose } = args;
  const result = emptyResult(company);
  const flags = [...sidecarFlags];
  const bankResult = pipeline.bankResult;

  result.analysisFamily = "financial-institution";
  result.family = "financial-institution";
  result.subtype = bankResult?.subtype ?? null;
  result.pipelineStrategyId = pipeline.pipelineStrategyId ?? trace.pipelineStrategyId ?? null;
  result.rigor = traceSnapshot(trace);
  result.rigorLevel = result.rigor.currentLevel ?? undefined;
  result.parserFidelityStatus = result.rigor.parserFidelityStatus ?? undefined;
  result.reconciliationStatus = result.rigor.reconciliationStatus ?? undefined;
  result.anomalyFlagKeys = anomalyFlagKeys(pipeline);
  result.metrics = bankMetricsSnapshot(pipeline);
  result.periods = bankResult?.bankMetrics?.length ?? bankResult?.periods.length ?? 0;
  result.latestPeriod = bankResult?.bankMetrics?.at(-1)?.period_end ?? bankResult?.periods.at(-1)?.period_end ?? null;

  if (!bankResult) {
    flags.push("CALC_ERROR:NO_BANK_RESULT");
    result.flags = flags;
    return finalize(result, deriveResultOutcome(result, false));
  }

  const valuation = bankResult.valuation;
  if (!valuation) {
    flags.push("MODEL_GAP:NO_FINANCIAL_VALUATION");
    result.modelApplicability.financialInstitutionValuation = {
      status: "model-gap",
      reason: "bankResult.valuation is null",
      models: [],
    };
  } else {
    pushInvalidIfComputed(flags, "JUSTIFIED_PB", valuation.justifiedPB);
    pushInvalidIfComputed(flags, "EQUITY_RI", valuation.equityResidualIncome);
    pushInvalidIfComputed(flags, "SUSTAINABLE_DDM", valuation.sustainableDDM);
    pushInvalidIfComputed(flags, "EV_BASED", valuation.evBased);
    pushInvalidIfComputed(flags, "P_AUM", valuation.pAum);
    pushInvalidIfComputed(flags, "ROA_LEVERAGE_RI", valuation.roaLeverageRI);

    result.models = computedBankModelNames(valuation);
    result.triangulatedValue = finiteOrNull(valuation.triangulatedValue);

    const cards = valuation.scenarios?.cards ?? [];
    const primaryKey = valuation.scenarios?.primary ?? "base";
    const primary = cards.find((card) => card.key === primaryKey)
      ?? cards.find((card) => card.key === "base")
      ?? cards[0]
      ?? null;
    result.stress = finiteOrNull(cards.find((card) => card.key === "stress")?.intrinsicValue);
    result.base = finiteOrNull(cards.find((card) => card.key === "base")?.intrinsicValue);
    result.bull = finiteOrNull(cards.find((card) => card.key === "bull")?.intrinsicValue);
    result.sotp = finiteOrNull(valuation.sotp?.totalEnterpriseValue);
    result.valuation = {
      stress: result.stress,
      base: result.base,
      bull: result.bull,
      revDcfGrowth: null,
      sotpTotal: result.sotp,
      epvPerShare: null,
      evEbitdaEv: null,
    };
    result.bankValuation = {
      subtype: bankResult.subtype ?? null,
      fairPB: primary?.fairPB ?? null,
      fairValue: primary?.intrinsicValue ?? null,
      upsidePct: primary?.upsidePct ?? null,
      primaryScenario: primaryKey,
    };

    const keyMap: Record<string, string> = {
      PB: "bank-pb",
      ERI: "bank-eri",
      DDM: "bank-ddm",
      EV: "bank-ev",
      "P/AUM": "bank-paum",
      "ROA×LevRI": "bank-roa-leveri",
    };
    result.valuationEvidence = {
      readinessStatus: "production-ready",
      readinessAnchorPeriod: result.latestPeriod,
      defensibilityStatus: "confirmed",
      triangulationMethods: result.models.map((name) => ({ key: keyMap[name] ?? name.toLowerCase(), label: name, perShare: null })),
      independentLensGroups: ["book-value", "residual-income", "distribution"],
    };

    result.modelApplicability.financialInstitutionValuation = {
      status: result.models.length > 0 || result.triangulatedValue != null ? "computed" : "model-gap",
      reason: result.models.length > 0 || result.triangulatedValue != null
        ? "bankResult.valuation produced financial-institution models"
        : "bankResult.valuation did not produce contributing models",
      models: result.models,
    };

    if (bankResult.subtype === "insurance") {
      if (valuation.evBased?.status !== "computed") {
        const reason = valuation.evBased?.reason ?? "insurance EV/VNB valuation did not compute";
        const tag = reason.toLowerCase().includes("sidecar") || reason.toLowerCase().includes("embedded value")
          ? "EXPECTED_SKIP_MISSING_SIDECAR:INSURANCE_EV_VNB"
          : "MODEL_GAP:INSURANCE_EV_VNB";
        flags.push(tag);
        if (verbose) flags.push(`DETAIL:${reason}`);
      }
    } else if (result.triangulatedValue == null || result.models.length === 0) {
      flags.push("MODEL_GAP:NO_FINANCIAL_TRIANGULATION");
    }
  }

  result.modelApplicability.industrialCommandCenter = {
    status: "skipped",
    reason: "financial-institution company routed through bankResult.valuation",
    models: [],
  };
  result.flags = flags;
  return finalize(result, deriveResultOutcome(result, result.triangulatedValue != null || result.models.length > 0));
}

function industrialResult(args: {
  company: AuditRegistryEntry;
  pipeline: PipelineResult;
  valuation: ValuationCommandCenterOutput;
  sidecarFlags: string[];
  trace: ReturnType<typeof buildAnalysisTraceability>;
}): AuditCompanyRunResult {
  const { company, pipeline, valuation, sidecarFlags, trace } = args;
  const result = emptyResult(company);
  const flags: string[] = [...sidecarFlags];

  result.analysisFamily = "industrial";
  result.family = "industrial";
  result.pipelineStrategyId = pipeline.pipelineStrategyId ?? trace.pipelineStrategyId ?? "industrial-v1";
  result.periods = pipeline.periods.length;
  result.latestPeriod = pipeline.periods.at(-1)?.period_end ?? null;
  result.rigor = traceSnapshot(trace);
  result.rigorLevel = result.rigor.currentLevel ?? undefined;
  result.parserFidelityStatus = result.rigor.parserFidelityStatus ?? undefined;
  result.reconciliationStatus = result.rigor.reconciliationStatus ?? undefined;
  result.anomalyFlagKeys = anomalyFlagKeys(pipeline);
  result.metrics = industrialMetricsSnapshot(pipeline.periods);

  const scenarios = valuation.scenarios || [];
  result.stress = finiteOrNull(scenarios.find((s) => s.key === "stress")?.intrinsicPerShare);
  result.base = finiteOrNull(scenarios.find((s) => s.key === "base")?.intrinsicPerShare);
  result.bull = finiteOrNull(scenarios.find((s) => s.key === "bull")?.intrinsicPerShare);
  result.triangulatedValue = result.base;
  result.sotp = finiteOrNull(valuation.sotp?.totalEnterpriseValue);
  result.revDcf = finiteOrNull(valuation.reverseDcf?.impliedOwnerEarningsGrowth);
  result.epv = finiteOrNull(valuation.epv?.epvPerShare);
  result.evEbitda = finiteOrNull(valuation.evEbitda?.enterpriseValue);
  result.valuation = {
    stress: result.stress,
    base: result.base,
    bull: result.bull,
    revDcfGrowth: result.revDcf,
    sotpTotal: result.sotp,
    epvPerShare: result.epv,
    evEbitdaEv: result.evEbitda,
  };
  result.valuationEvidence = industrialValuationEvidenceSnapshot(valuation);
  result.models = computedIndustrialModelNames(valuation);

  const strategy = result.pipelineStrategyId;
  if (strategy === "telecom-v1") result.models.push("TELECOM_NATIVE");
  if (strategy === "utility-v1") result.models.push("UTILITY_RAB");
  if (strategy === "cyclical-v1") result.models.push("CYCLICAL_MID_CYCLE");
  if (strategy === "loss-maker-v1") result.models.push("LOSS_MAKER_RUNWAY");

  if (strategy && strategy !== "industrial-v1") {
    result.valuationEvidence.independentLensGroups.push("sector-native");
    const baseKey = strategy.replace("-v1", "");
    if (!result.valuationEvidence.triangulationMethods.some((m) => m.key === baseKey)) {
      result.valuationEvidence.triangulationMethods.push({ key: baseKey, label: `${baseKey} native`, perShare: null });
    }
  }

  if (scenarios.length === 0) flags.push("NO_SCENARIOS");
  if (result.stress === null && scenarios.some((s) => s.key === "stress")) flags.push("STRESS_INVALID");
  if (result.base === null && scenarios.some((s) => s.key === "base")) flags.push("BASE_INVALID");
  if (result.bull === null && scenarios.some((s) => s.key === "bull")) flags.push("BULL_INVALID");
  if (result.revDcf !== null && !Number.isFinite(result.revDcf)) flags.push("REVDCF_INVALID");
  if (company.type === "conglomerate" && result.sotp === null) flags.push("MODEL_GAP:CONGLO_NO_SOTP");
  if (result.epv !== null && !Number.isFinite(result.epv)) flags.push("EPV_INVALID");
  if (result.evEbitda !== null && !Number.isFinite(result.evEbitda)) flags.push("EVEBITDA_INVALID");

  result.modelApplicability.industrialCommandCenter = {
    status: result.models.length > 0 || result.base != null ? "computed" : "model-gap",
    reason: result.models.length > 0 || result.base != null
      ? "industrial command center produced scenario valuation"
      : "industrial command center produced no scenarios",
    models: result.models,
  };
  result.modelApplicability.financialInstitutionValuation = {
    status: "skipped",
    reason: "non-financial company routed through industrial command center",
    models: [],
  };

  result.flags = flags;
  return finalize(result, deriveResultOutcome(result, result.base != null || result.triangulatedValue != null));
}

export async function auditCompanyRun(
  company: AuditRegistryEntry,
  options: AuditCompanyRunOptions = {},
): Promise<AuditCompanyRunResult> {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const sourceEvidence = buildSourceEvidence(projectRoot, company);
  const marketEvidence = await fetchMarketEvidence(company.ticker, company.folder);
  const zipPath = join(companiesDir(projectRoot), company.folder, `${company.folder}.zip`);

  if (!existsSync(zipPath)) {
    const result = emptyResult(company);
    result.flags = ["CALC_ERROR:MISSING_ZIP"];
    result.marketEvidence = marketEvidence;
    return withSourceEvidence(finalize(result, deriveResultOutcome(result, false)), sourceEvidence);
  }

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
    const { quality, flags: sidecarFlags } = loadQualitySidecar(projectRoot, company.folder);
    const pipeline = processCompanyDataFull(parsed.periods, config, quality);
    const analysisContext = buildAuditAnalysisContext({ pipeline });
    const industrialValuation = pipeline.analysisFamily === "financial-institution"
      ? null
      : buildValuationCommandCenter({
        data: pipeline.periods,
        config,
        marketData: null,
        analysisStatus: analysisContext.analysisStatus,
        segmentData: selectBusinessSegmentData(parsed.segmentData),
      });
    const trace = buildTrace({
      company,
      config,
      pipeline,
      parsed,
      generatedAt: options.generatedAt ?? "2026-06-04T00:00:00.000Z",
      analysisContext,
      valuation: industrialValuation,
    });

    if (pipeline.analysisFamily === "financial-institution") {
      const result = financialResult({ company, pipeline, sidecarFlags, trace, verbose: Boolean(options.verbose) });
      result.marketEvidence = marketEvidence;
      return withSourceEvidence(result, sourceEvidence, trace.lineageRef);
    }
    if (!industrialValuation) {
      throw new Error("Industrial valuation was not computed for non-financial audit route");
    }

    const result = industrialResult({
      company,
      pipeline,
      valuation: industrialValuation,
      sidecarFlags,
      trace,
    });
    result.marketEvidence = marketEvidence;
    return withSourceEvidence(result, sourceEvidence, trace.lineageRef);
  } catch (error) {
    const result = emptyResult(company);
    const message = (error as Error).message;
    result.flags = [`CALC_ERROR:${message}`];
    result.error = message;
    result.marketEvidence = marketEvidence;
    return withSourceEvidence(finalize(result, deriveResultOutcome(result, false)), sourceEvidence);
  }
}
