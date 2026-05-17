/**
 * Processing Pipeline — V2-FINAL
 * Integrates: engine computation, anomaly detection (S-5.x),
 * kw derivation (S-9.4), and per-period flag attachment.
 * Routes to bank pipeline when financial institution detected.
 */
import { RawPeriodData, RecastPeriod, EngineConfig, ke_from_config } from "./types";
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

export interface PipelineResult {
  periods  : RecastPeriod[];
  anomalies: AnomalyBundle;
  analysisFamily: "industrial" | "financial-institution";
  bankResult?: FinancialInstitutionAnalysisResult;
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
export function processCompanyDataFull(
  dataArray: RawPeriodData[],
  config: EngineConfig,
  quality: BankQualityIndicators | null = null,
): PipelineResult {
  if (!dataArray || dataArray.length === 0) {
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "industrial", distress, structuralBreakPeriods: [], lossMaker: null, itServices: null, cyclicality: null };
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

  // Route to bank pipeline only if financial institution AND not blocked.
  if (family === "financial-institution" && !scope.blocked) {
    const bankResult = processBankData(filteredData, scope, config, null, quality);
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "financial-institution", bankResult, distress, structuralBreakPeriods: [], lossMaker: null, itServices: null, cyclicality: null };
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
      console.error(`[pipeline] recast error @ ${raw.period_end}:`, err);
      throw new Error(`Failed to recast period ${raw.period_end}: ${err instanceof Error ? err.message : String(err)}`);
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
        console.error(`[pipeline] ratio/quality error @ ${raw.period_end}:`, err);
        throw new Error(`Failed to derive ratios/quality for period ${raw.period_end}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    results.push(recast);
  }

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
  const itServices = detectITServices(results);
  const cyclicality = assessCyclicality(results);

  return { periods: results, anomalies, analysisFamily: "industrial", distress: detectDistress(results), structuralBreakPeriods, lossMaker, itServices, cyclicality };
}
