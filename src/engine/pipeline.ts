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

export interface PipelineResult {
  periods  : RecastPeriod[];
  anomalies: AnomalyBundle;
  analysisFamily: "industrial" | "financial-institution";
  bankResult?: FinancialInstitutionAnalysisResult;
}

export function processCompanyData(
  dataArray: RawPeriodData[],
  config: EngineConfig,
): RecastPeriod[] {
  return processCompanyDataFull(dataArray, config).periods;
}

export function processCompanyDataFull(
  dataArray: RawPeriodData[],
  config: EngineConfig,
): PipelineResult {
  if (!dataArray || dataArray.length === 0) {
    const emptyAnomalies = runAnomalyDetection([], config);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "industrial" };
  }

  // Detect company type from data
  const scope = assessAnalysisScope(dataArray, config);
  const family = analysisFamilyFromScope(scope);

  // Route to bank pipeline if financial institution
  if (family === "financial-institution" && !scope.blocked) {
    const bankResult = processBankData(dataArray, scope);
    const emptyAnomalies = runAnomalyDetection([], config);
    return { periods: [], anomalies: emptyAnomalies, analysisFamily: "financial-institution", bankResult };
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

  return { periods: results, anomalies, analysisFamily: "industrial" };
}
