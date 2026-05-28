/* ================================================================
   Plan 3 PR-3.3 — Bank pipeline strategy.

   Same shim pattern as IndustrialPipelineStrategy: delegates
   to the existing processBankData while exposing the
   PipelineStrategy contract so the orchestrator can dispatch
   uniformly.

   matches() returns true ONLY when config.company_type === "bank".
   Auto-detected banks (company_type === "auto" with bank-shaped
   raw data) still flow through the industrial-shim, which
   delegates to processCompanyDataFull, which contains the
   scope-detection branch that routes to processBankData. Behaviour
   is identical; explicit bank configs just get a more direct path.

   Bank pipeline emits BankPeriodMetrics — an entirely different row
   shape from RecastPeriod. Per the strategy contract, recast()
   returns [] (no industrial periods); the bank-specific output is
   carried via sectorBlocks in contributeToEnvelope().
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

export class BankPipelineStrategy implements PipelineStrategy {
  readonly id = "bank-v1";
  readonly kind = "bank" as const;
  readonly version = "1.0.0";

  /**
   * Matches when the user has explicitly classified the company as a
   * bank. Auto-detected banks remain on the industrial-shim code path
   * (which still routes them to processBankData internally), so there
   * is no behaviour change for "auto" runs.
   */
  matches(_rawData: RawPeriodData[], config: EngineConfig): boolean {
    void _rawData;
    return config.company_type === "bank";
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

  /**
   * Bank pipelines do NOT produce industrial RecastPeriod rows; their
   * canonical output is BankPeriodMetrics. Per the strategy contract,
   * we return [] here and stash the bank-specific result block in
   * sectorBlocks via contributeToEnvelope().
   */
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
    return { flags: [], details: { note: "bank anomalies surfaced via bankResult.bankMetrics" } };
  }

  value(_input: ValuationInput): ValuationResult {
    void _input;
    throw new Error(
      "BankPipelineStrategy.value(): not implemented in canary. Bank valuation runs inside processBankData() until PR-3.5 lands the orchestrator switch.",
    );
  }

  /**
   * Side-channel: when the orchestrator wants the bank result, it
   * calls processBankData() directly (the function is stable). This
   * method records strategy metadata so an audit can trace which
   * strategy fired.
   */
  contributeToEnvelope(ctx: EnvelopeContext): SectorEnvelopeContribution {
    let scopeBlocked = false;
    try {
      const scope = assessAnalysisScope(ctx.rawData, ctx.config);
      scopeBlocked = scope.blocked;
    } catch {
      // assessAnalysisScope throws on malformed data; let the strategy
      // contribute "blocked" rather than failing the run.
      scopeBlocked = true;
    }
    return {
      sectorStatus: {
        status: scopeBlocked ? "blocked" : "production-ready",
        reasons: scopeBlocked ? ["bank scope assessment blocked"] : [],
      },
      sectorBlocks: { strategy: this.id, version: this.version },
    };
  }

  /** Bank-specific helper exposed for the orchestrator (PR-3.5). */
  runBankPipeline(rawData: RawPeriodData[], config: EngineConfig) {
    const scope = assessAnalysisScope(rawData, config);
    const marketCapCr =
      config.market_price != null && config.shares_outstanding != null
        ? config.market_price * config.shares_outstanding
        : null;
    return processBankData(rawData, scope, config, marketCapCr, null);
  }
}

/** Side-effect: register the bank strategy on import. */
registerStrategy(new BankPipelineStrategy());
