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

export interface PipelineResult {
  periods  : RecastPeriod[];
  anomalies: AnomalyBundle;
  analysisFamily: "industrial" | "financial-institution";
  bankResult?: FinancialInstitutionAnalysisResult;
  /**
   * Phase J1: financial distress assessment. Surfaces negative-equity /
   * cash-burn signals so downstream consumers (valuation modules, UI)
   * can fail-closed on equity-side models. Always present (non-distressed
   * datasets get severity="none", equityModelsBlocked=false).
   */
  distress: DistressAssessment;
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
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "industrial", distress };
  }

  // Detect company type from data
  const scope = assessAnalysisScope(dataArray, config);
  const family = analysisFamilyFromScope(scope);

  // Route to bank pipeline only if financial institution AND not blocked.
  if (family === "financial-institution" && !scope.blocked) {
    // Phase B4: pass config so the bank pipeline can also produce
    // valuation results (justified P/B, equity residual income, DDM).
    // Market cap is not in EngineConfig today — null until UI passes it.
    // Phase B5: thread the optional quality indicators sidecar through.
    const bankResult = processBankData(dataArray, scope, config, null, quality);
    const emptyAnomalies = runAnomalyDetection([], config);
    // Bank pipeline produces no industrial RecastPeriod[]. Distress for banks
    // is handled inside bankValuation (skip-with-reason on bookValue ≤ 0),
    // so the industrial detector returns "none" for an empty period array
    // and downstream consumers should rely on bankResult.* skip reasons.
    const distress = detectDistress([]);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "financial-institution", bankResult, distress };
  }

  // Fail-closed: if scope is financial-institution but blocked (insurance-only,
  // mixed-financial-conglomerate), return an inert result. Without this guard,
  // execution would silently fall through to the industrial Penman-Nissim path
  // and produce a meaningless valuation for an unsupported scope (review C5).
  if (family === "financial-institution" && scope.blocked) {
    const emptyAnomalies = runAnomalyDetection([], config);
    const distress = detectDistress([]);
    return {
      periods: [],
      anomalies: emptyAnomalies,
      analysisFamily: "financial-institution",
      distress,
    };
  }

  const sorted = [...dataArray].sort(
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
  // reSeries built from ri fields
  const reSeries = results
    .filter(p => p.ri?.RE != null)
    .map(p => ({ period: p.period_end, RE: p.ri!.RE!, ReOI: p.ri!.ReOI! }));

  const anomalies = runAnomalyDetection(results, config, reSeries);

  // Attach per-period flags back to each RecastPeriod (S-5.7)
  for (const period of results) {
    period.spec_flags = anomalies.periodSummaries
      .find(s => s.period_end === period.period_end)
      ?.all_flags ?? [];
    period.cu.policy = buildUnusualItemPolicy(period);
  }

  return { periods: results, anomalies, analysisFamily: "industrial", distress: detectDistress(results) };
}
