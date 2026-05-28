/**
 * Processing Pipeline — V2-FINAL
 * Integrates: engine computation, anomaly detection (S-5.x),
 * kw derivation (S-9.4), and per-period flag attachment.
 * Routes to bank pipeline when financial institution detected.
 */
import { RawPeriodData, RecastPeriod, EngineConfig, CompanyType, ke_from_config } from "./types";
import {
  computeRecastPeriod, computeRatios,
  computeResidualIncome, computeQuality, deriveKwFromStructure,
} from "./PenmanNissimEngine";
import { runAnomalyDetection, AnomalyBundle } from "./anomalyDetection";
import { buildUnusualItemPolicy } from "./unusualItemPolicy";
import { assessAnalysisScope, analysisFamilyFromScope } from "./scopePolicy";
import { processBankData } from "./bankPipeline";
import { FinancialInstitutionAnalysisResult } from "./analysisFamily";
import { detectDistress, DistressAssessment } from "./distressDetector";
import type { BankQualityIndicators } from "./bankQualityIndicators";
import { computeLossMakerValuation, LossMakerValuationResult } from "./lossMakerValuation";
import { detectITServices, ITServicesSignal } from "./itServicesDetector";
import { assessCyclicality, CyclicalityAssessment } from "./cyclicalityDetector";
import { evaluateRatioSanity, SanityAssessment } from "./ratioSanity";
import { trace } from "../lib/traceLogger";

export interface PipelineResult {
  periods  : RecastPeriod[];
  anomalies: AnomalyBundle;
  analysisFamily: "industrial" | "financial-institution";
  bankResult?: FinancialInstitutionAnalysisResult | undefined;
  /**
   * Phase J1: financial distress assessment.
   */
  distress: DistressAssessment;
  /**
   * Phase I9 — structural break periods.
   * Period_ends where S-5.1 STRUCTURAL_EVENT (dirty surplus spike) fired.
   * Empty array when no breaks detected.
   */
  structuralBreakPeriods: string[];
  /**
   * Phase I3 — loss-maker valuation anchors.
   * Populated when ≥50% of periods have CNI ≤ 0. Null for profitable companies.
   */
  lossMaker: LossMakerValuationResult | null;
  /**
   * Phase E1 — IT-services fingerprint.
   * Populated for all industrial pipelines. isITServices=true when
   * employee cost > 40% of revenue AND PPE < 10% of assets (median).
   */
  itServices: ITServicesSignal | null;
  /**
   * Phase F — Cyclicality assessment.
   * Populated for all industrial pipelines with ≥5 periods.
   * Classifies latest period as peak/trough/mid-cycle vs history.
   */
  cyclicality: CyclicalityAssessment | null;
  /**
   * Phase 9 — Economic ratio sanity assessment.
   * Anchor ratio bands per company type catch outputs that reconcile
   * structurally but produce economically impossible numbers (e.g. a
   * "bank" with 60% NIM, an "IT-services" firm with 5% PM).
   */
  ratioSanity: SanityAssessment | null;
  /**
   * B6 — Period frequency warning.
   * Null when all gaps are annual (330-400 days).
   * Set when quarterly or mixed-frequency data is detected.
   */
  frequencyWarning: string | null;
}

export function processCompanyData(
  dataArray: RawPeriodData[],
  config: EngineConfig,
): RecastPeriod[] {
  return processCompanyDataFull(dataArray, config).periods;
}

/**
 * Process raw period data through the engine.
 *
 * @param dataArray  Raw period records as parsed from Capitaline / etc.
 * @param config     Engine config (ke, kw, tax rate, etc.)
 * @param quality    Optional Phase B5 sidecar — bank asset-quality
 *                   indicators (GNPA, NNPA, PCR, CRAR, slippage, CASA,
 *                   growth) joined into BankPeriodMetrics.quality when
 *                   family is financial-institution. Ignored for
 *                   industrial pipelines.
 */
/** B6 — Detect period frequency from date gaps.
 * Returns a warning string when quarterly or mixed-frequency data is found.
 * Annual = 330-400 day gaps. Quarterly = ~90 day gaps. */
function detectFrequencyWarning(sorted: { period_end: string }[]): string | null {
  if (sorted.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = (new Date(sorted[i].period_end).getTime() - new Date(sorted[i-1].period_end).getTime()) / 86_400_000;
    gaps.push(days);
  }
  const quarterly = gaps.filter(d => d >= 60 && d <= 120).length;
  const annual    = gaps.filter(d => d >= 330 && d <= 400).length;
  const other     = gaps.length - quarterly - annual;
  if (quarterly === gaps.length) {
    return `All ${gaps.length} gaps are quarterly (~90 days). Ratios computed on quarterly data will be annualised incorrectly. Upload annual Capitaline exports only.`;
  }
  if (quarterly > 0 || other > 0) {
    return `Mixed period frequencies detected: ${annual} annual, ${quarterly} quarterly, ${other} other gaps. Time-series ratios (growth rates, RNOA trends) may be unreliable. Use annual Capitaline exports only.`;
  }
  return null;
}

export function processCompanyDataFull(
  dataArray: RawPeriodData[],
  config: EngineConfig,
  quality: BankQualityIndicators | null = null,
): PipelineResult {
  trace("pipeline", "processCompanyDataFull:enter", {
    periods: dataArray?.length ?? 0,
    hasQuality: quality != null,
    companyType: config.company_type ?? "auto",
    ke: config.ke ?? null,
    riskFreeRate: config.risk_free_rate ?? null,
    excludedPeriods: config.excluded_periods?.length ?? 0,
  });

  try {

  if (!dataArray || dataArray.length === 0) {
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "industrial", distress, structuralBreakPeriods: [], lossMaker: null, itServices: null, cyclicality: null, ratioSanity: null, frequencyWarning: null };
  }

  // Phase I9 — apply user-confirmed period exclusions before any processing.
  // excluded_periods is a list of period_end strings the user has explicitly
  // opted to exclude (typically pre-demerger / pre-merger periods identified
  // by the S-5.1 STRUCTURAL_EVENT flag). Exclusion is applied here so the
  // entire pipeline (recast, ratios, anomaly detection, valuation) sees only
  // the clean post-break window.
  const excluded = new Set(config.excluded_periods ?? []);
  const filteredData = excluded.size > 0
    ? dataArray.filter(p => !excluded.has(p.period_end))
    : dataArray;

  // Detect company type from data
  const scope = assessAnalysisScope(filteredData, config);
  const family = analysisFamilyFromScope(scope);
  trace("scope", "assessed", {
    classification: scope.classification,
    family,
    signals: scope.signals,
    blocked: scope.blocked,
  });

  // Route to bank pipeline only if financial institution AND not blocked.
  if (family === "financial-institution" && !scope.blocked) {
    trace("pipeline", "routeToBank", { family, subtype: scope.classification });
    const marketCapCr = config.market_price != null && config.shares_outstanding != null
      ? config.market_price * config.shares_outstanding
      : null;
    const bankResult = processBankData(filteredData, scope, config, marketCapCr, quality);
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
 // Phase 9 — sanity check bank/NBFC metrics
 // When company_type is "auto" (the default), use the detected subtype
 // from the bank pipeline instead of passing "auto" which would route
 // to industrial sanity bands — defeating the purpose entirely.
 // Map "generic-financial" (not a CompanyType) to "nbfc" for sanity checks.
 const latestBank = bankResult?.bankMetrics && bankResult.bankMetrics.length > 0
 ? bankResult.bankMetrics[bankResult.bankMetrics.length - 1]
 : null;
 let effectiveCompanyType: CompanyType | "auto" = config.company_type ?? "auto";
 if (effectiveCompanyType === "auto" && bankResult?.subtype) {
 effectiveCompanyType = bankResult.subtype === "generic-financial"
 ? "nbfc"
 : bankResult.subtype === "insurance"
 ? "auto" // insurance has no sanity bands
 : bankResult.subtype;
 }
 const ratioSanity = latestBank
 ? evaluateRatioSanity({
 companyType: effectiveCompanyType,
 bank: {
 nim: latestBank.nim,
 roa: latestBank.roa,
 roe: latestBank.roe,
 costToIncome: latestBank.costToIncome,
 creditCost: latestBank.creditCost,
 leverage: latestBank.leverage,
 spread: latestBank.spread,
 yieldOnAdvances: latestBank.yieldOnAdvances,
 costOfBorrowings: latestBank.costOfBorrowings,
 },
 })
      : null;
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "financial-institution", bankResult, distress, structuralBreakPeriods: [], lossMaker: null, itServices: null, cyclicality: null, ratioSanity, frequencyWarning: null };
  }

  // Fail-closed for blocked financial-institution scope.
  if (family === "financial-institution" && scope.blocked) {
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
    return {
      periods: [],
      anomalies: emptyAnomalies,
      analysisFamily: "financial-institution",
      distress,
      structuralBreakPeriods: [],
      lossMaker: null,
      itServices: null,
      cyclicality: null,
      ratioSanity: null,
      frequencyWarning: null,
    };
  }

  const sorted = [...filteredData].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  // S-9.4: ke derived from config — prefer explicit ke, fall back to rf+erp
  const ke = ke_from_config(config);

  const results: RecastPeriod[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    let recast: RecastPeriod;
    try {
      const prev = results.length > 0 ? results[results.length - 1] : undefined;
      recast = computeRecastPeriod(raw, config, prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace("pipeline", "recast:error", { period_end: raw.period_end, error: msg }, null, { level: "error" });
      throw new Error(`Failed to recast period ${raw.period_end}: ${msg}`);
    }

    if (i > 0 && results.length > 0) {
      const prev    = results[results.length - 1];
      const prevRaw = sorted[i - 1];
      try {
        recast.ratios = computeRatios(recast, prev, config);
        // S-9.4: kw ALWAYS derived from balance-sheet structure, never hardcoded
        const kwDerived = deriveKwFromStructure(recast, prev, ke, config.risk_free_rate, config);
        recast.ri      = computeResidualIncome(recast, prev, ke, kwDerived);
        recast.quality = computeQuality(recast, prev, raw, prevRaw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace("pipeline", "ratioQuality:error", { period_end: raw.period_end, error: msg }, null, { level: "error" });
        throw new Error(`Failed to derive ratios/quality for period ${raw.period_end}: ${msg}`);
      }
    }
    results.push(recast);
  }

  trace("pipeline", "recastComplete", {
    periods: results.length,
    latestPeriod: results.length > 0 ? results[results.length - 1].period_end : null,
    hasRatios: results.length > 1 && results[results.length - 1].ratios != null,
    hasRI: results.length > 1 && results[results.length - 1].ri != null,
  });

  // Run anomaly detection over all periods (S-5.x)
  const reSeries = results
    .filter(p => p.ri?.RE != null)
    .map(p => ({ period: p.period_end, RE: p.ri!.RE!, ReOI: p.ri!.ReOI! }));

  const anomalies = runAnomalyDetection(results, config, reSeries);

  // Phase I9 — extract structural break periods from S-5.1 STRUCTURAL_EVENT flags.
  // These are surfaced in PipelineResult so App.tsx can offer the confirmation flow.
  const structuralBreakPeriods = anomalies.dsSeries
    .filter(ds => ds.flags.some(f => f.label === "STRUCTURAL_EVENT"))
    .map(ds => ds.period_end);

  // Attach per-period flags back to each RecastPeriod (S-5.7)
  for (const period of results) {
    period.spec_flags = anomalies.periodSummaries
      .find(s => s.period_end === period.period_end)
      ?.all_flags ?? [];
    period.cu.policy = buildUnusualItemPolicy(period);
  }

  const lossMaker = computeLossMakerValuation(results, config);
  const itServices = detectITServices(results, config.company_type);
  const cyclicality = assessCyclicality(results, config.company_type);

  // Phase 9 — sanity-check the latest period's industrial ratios.
  // When company_type is "auto", resolve the effective type from detected
  // signals rather than passing "auto" which has no sanity bands.
  const latest = results.length > 0 ? results[results.length - 1] : null;
  let industrialEffectiveType: CompanyType | "auto" = config.company_type ?? "auto";
  if (industrialEffectiveType === "auto") {
    if (itServices?.isITServices) {
      industrialEffectiveType = "it-services";
    } else if (cyclicality && cyclicality.classification !== "non-cyclical") {
      industrialEffectiveType = "cyclical";
    }
    // else stays "auto" — evaluateRatioSanity will use the broad industrial bands
  }
  const ratioSanity = latest && latest.ratios
    ? evaluateRatioSanity({
        companyType: industrialEffectiveType,
        industrial: {
          ROCE: latest.ratios.ROCE,
          RNOA: latest.ratios.RNOA,
          PM: latest.ratios.PM,
          SalesPM: latest.ratios.SalesPM,
          FLEV: latest.ratios.FLEV,
        },
      })
    : null;

  const frequencyWarning = detectFrequencyWarning(sorted);
  const result: PipelineResult = { periods: results, anomalies, analysisFamily: "industrial", distress: detectDistress(results), structuralBreakPeriods, lossMaker, itServices, cyclicality, ratioSanity, frequencyWarning };
  trace("pipeline", "processCompanyDataFull:exit", {
    family: result.analysisFamily,
    hasRecast: result.periods.length > 0,
    hasBankResult: result.bankResult != null,
    periodCount: result.periods.length,
  });
  return result;

  } catch (err) {
    trace("pipeline", "processCompanyDataFull:error", { error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    throw err;
  }
}
