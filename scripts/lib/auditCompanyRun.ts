import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../../src/engine/capitalineParser";
import { processCompanyDataFull, type PipelineResult } from "../../src/engine/pipeline";
import {
  buildValuationCommandCenter,
  type ValuationCommandCenterOutput,
} from "../../src/engine/valuationCommandCenter";
import { buildAnalysisTraceability } from "../../src/engine/analysisTraceability";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(__dirname, "..", "..");

export interface AuditRegistryEntry {
  folder: string;
  name?: string;
  ticker: string;
  type: string;
  hasStandalone?: boolean;
}

export type AuditOutcome =
  | "OK_COMPUTED"
  | "EXPECTED_SKIP_MISSING_SIDECAR"
  | "EXPECTED_SCOPE_CAP"
  | "MODEL_GAP"
  | "CALC_ERROR"
  | "POLICY_WARNING";

export type AuditStatusClass =
  | "ok-computed"
  | "expected-skip"
  | "scope-cap"
  | "model-gap"
  | "calc-error"
  | "policy-warning";

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

export function statusClassFromOutcome(outcome: AuditOutcome): AuditStatusClass {
  switch (outcome) {
    case "OK_COMPUTED": return "ok-computed";
    case "EXPECTED_SKIP_MISSING_SIDECAR": return "expected-skip";
    case "EXPECTED_SCOPE_CAP": return "scope-cap";
    case "MODEL_GAP": return "model-gap";
    case "CALC_ERROR": return "calc-error";
    case "POLICY_WARNING": return "policy-warning";
  }
}

export function deriveAuditOutcome(flags: string[], hasComputedValue: boolean): AuditOutcome {
  if (flags.some((f) => f.startsWith("ERROR") || f.startsWith("CALC_ERROR") || f.endsWith("_INVALID"))) {
    return "CALC_ERROR";
  }
  if (flags.some((f) => f.startsWith("MODEL_GAP") || f === "CONGLO_NO_SOTP" || f === "NO_SCENARIOS")) {
    return "MODEL_GAP";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SCOPE_CAP"))) {
    return "EXPECTED_SCOPE_CAP";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SKIP_MISSING_SIDECAR"))) {
    return "EXPECTED_SKIP_MISSING_SIDECAR";
  }
  if (flags.length > 0) {
    return "POLICY_WARNING";
  }
  return hasComputedValue ? "OK_COMPUTED" : "MODEL_GAP";
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

function buildTrace(args: {
  company: AuditRegistryEntry;
  config: EngineConfig;
  pipeline: PipelineResult;
  parsed: Awaited<ReturnType<typeof parseCapitalineZip>>;
  generatedAt: string;
}) {
  const { company, config, pipeline, parsed, generatedAt } = args;
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
    policyVersions: getAnalysisPolicyVersions(),
    debugInfo: parsed.debug,
    hasDebugInfo: Boolean(parsed.debug),
    debugFiles: parsed.debug?.files?.length ?? 0,
    rawMetricKeyCount: parsed.debug?.rawMetricKeys?.length ?? 0,
    bankMetrics: pipeline.bankResult?.bankMetrics ?? null,
    bankSubtype: pipeline.bankResult?.subtype ?? null,
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
  result.pipelineStrategyId = trace.pipelineStrategyId ?? null;
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
    return finalize(result, deriveAuditOutcome(flags, false));
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
    result.triangulatedValue = finiteOrNull(valuation.triangulatedValue);
    result.sotp = finiteOrNull(valuation.sotp?.totalEnterpriseValue);
    result.bankValuation = {
      subtype: bankResult.subtype ?? null,
      fairPB: primary?.fairPB ?? null,
      fairValue: primary?.intrinsicValue ?? null,
      upsidePct: primary?.upsidePct ?? null,
      primaryScenario: primaryKey,
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
  return finalize(result, deriveAuditOutcome(flags, result.triangulatedValue != null || result.models.length > 0));
}

function industrialResult(args: {
  company: AuditRegistryEntry;
  pipeline: PipelineResult;
  parsedSegmentData: SegmentData | null;
  sidecarFlags: string[];
  trace: ReturnType<typeof buildAnalysisTraceability>;
}): AuditCompanyRunResult {
  const { company, pipeline, parsedSegmentData, sidecarFlags, trace } = args;
  const result = emptyResult(company);
  const flags: string[] = [...sidecarFlags];

  result.analysisFamily = "industrial";
  result.family = "industrial";
  result.pipelineStrategyId = trace.pipelineStrategyId ?? "industrial-v1";
  result.periods = pipeline.periods.length;
  result.latestPeriod = pipeline.periods.at(-1)?.period_end ?? null;
  result.rigor = traceSnapshot(trace);
  result.rigorLevel = result.rigor.currentLevel ?? undefined;
  result.parserFidelityStatus = result.rigor.parserFidelityStatus ?? undefined;
  result.reconciliationStatus = result.rigor.reconciliationStatus ?? undefined;
  result.anomalyFlagKeys = anomalyFlagKeys(pipeline);
  result.metrics = industrialMetricsSnapshot(pipeline.periods);

  const config = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
  const valuation: ValuationCommandCenterOutput = buildValuationCommandCenter({
    data: pipeline.periods,
    config,
    marketData: null,
    analysisStatus: null,
    segmentData: parsedSegmentData || null,
  });

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
  result.models = scenarios.length ? ["VCC"] : [];

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
  return finalize(result, deriveAuditOutcome(flags, result.base != null || result.triangulatedValue != null));
}

export async function auditCompanyRun(
  company: AuditRegistryEntry,
  options: AuditCompanyRunOptions = {},
): Promise<AuditCompanyRunResult> {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const zipPath = join(companiesDir(projectRoot), company.folder, `${company.folder}.zip`);

  if (!existsSync(zipPath)) {
    const result = emptyResult(company);
    result.flags = ["CALC_ERROR:MISSING_ZIP"];
    return finalize(result, deriveAuditOutcome(result.flags, false));
  }

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
    const { quality, flags: sidecarFlags } = loadQualitySidecar(projectRoot, company.folder);
    const pipeline = processCompanyDataFull(parsed.periods, config, quality);
    const trace = buildTrace({
      company,
      config,
      pipeline,
      parsed,
      generatedAt: options.generatedAt ?? "2026-06-04T00:00:00.000Z",
    });

    if (pipeline.analysisFamily === "financial-institution") {
      return financialResult({ company, pipeline, sidecarFlags, trace, verbose: Boolean(options.verbose) });
    }

    return industrialResult({
      company,
      pipeline,
      parsedSegmentData: selectBusinessSegmentData(parsed.segmentData),
      sidecarFlags,
      trace,
    });
  } catch (error) {
    const result = emptyResult(company);
    const message = (error as Error).message;
    result.flags = [`CALC_ERROR:${message}`];
    result.error = message;
    return finalize(result, deriveAuditOutcome(result.flags, false));
  }
}
