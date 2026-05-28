/* ================================================================
   Plan 3 PR-3.4 — Insurance pipeline strategy.

   Insurance shares the bankPipeline orchestration (subtype detection
   handles VNB/EV multiples internally). Same shim pattern.
================================================================ */

import type { RawPeriodData } from "../../types/raw";
import type { RecastPeriod } from "../../types/recast";
import type { ValuationResult } from "../../types/valuation";
import type { EngineConfig } from "../../types/config";
import { processBankData } from "../../bankPipeline";
import { assessAnalysisScope } from "../../scopePolicy";
import { registerStrategy } from "../registry";
import type {
  PipelineStrategy,
  ValidationReport,
  SectorRatios,
  AnomalyReport,
  ValuationInput,
  EnvelopeContext,
  SectorEnvelopeContribution,
} from "../strategy";

export class InsurancePipelineStrategy implements PipelineStrategy {
  readonly id = "insurance-v1";
  readonly kind = "insurance" as const;
  readonly version = "1.0.0";

  matches(_rawData: RawPeriodData[], config: EngineConfig): boolean {
    void _rawData;
    return config.company_type === "insurance";
  }

  validateRaw(rawData: RawPeriodData[]): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!Array.isArray(rawData)) {
      errors.push("rawData is not an array");
    } else if (rawData.length === 0) {
      warnings.push("rawData is empty");
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  recast(_rawData: RawPeriodData[], _config: EngineConfig): RecastPeriod[] {
    void _rawData;
    void _config;
    return [];
  }

  computeRatios(_recastData: RecastPeriod[], _config: EngineConfig): SectorRatios {
    void _recastData;
    void _config;
    return { kind: this.kind, rows: {} };
  }

  detectAnomalies(_rawData: RawPeriodData[], _recastData: RecastPeriod[]): AnomalyReport {
    void _rawData;
    void _recastData;
    return { flags: [], details: { note: "insurance anomalies surfaced via bankResult.bankMetrics" } };
  }

  value(_input: ValuationInput): ValuationResult {
    void _input;
    throw new Error(
      "InsurancePipelineStrategy.value(): not implemented in canary. Insurance valuation runs inside processBankData() until PR-3.5 lands the orchestrator switch.",
    );
  }

  contributeToEnvelope(ctx: EnvelopeContext): SectorEnvelopeContribution {
    let scopeBlocked = false;
    try {
      const scope = assessAnalysisScope(ctx.rawData, ctx.config);
      scopeBlocked = scope.blocked;
    } catch {
      scopeBlocked = true;
    }
    return {
      sectorStatus: {
        status: scopeBlocked ? "blocked" : "production-ready",
        reasons: scopeBlocked ? ["insurance scope assessment blocked"] : [],
      },
      sectorBlocks: { strategy: this.id, version: this.version },
    };
  }

  /** Insurance-specific helper exposed for the orchestrator (PR-3.5). */
  runInsurancePipeline(rawData: RawPeriodData[], config: EngineConfig) {
    const scope = assessAnalysisScope(rawData, config);
    const marketCapCr =
      config.market_price != null && config.shares_outstanding != null
        ? config.market_price * config.shares_outstanding
        : null;
    return processBankData(rawData, scope, config, marketCapCr, null);
  }
}

registerStrategy(new InsurancePipelineStrategy());
