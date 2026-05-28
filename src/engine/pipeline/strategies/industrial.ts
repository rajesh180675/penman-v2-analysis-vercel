/* ================================================================
   Plan 3 PR-3.2 — Industrial pipeline strategy (canary).

   This is the reference implementation of PipelineStrategy. It's a
   thin shim that delegates to the existing processCompanyDataFull
   while exposing the per-stage interface methods for future
   orchestrator refactors (PR-3.3 onwards).

   Why a shim and not a full per-stage rewrite:
     - processCompanyDataFull entwines stages with feature-detection
       (loss-maker, IT services, cyclicality) that don't fit cleanly
       into the 6-stage interface yet.
     - Migrating piecemeal preserves the test contract; the canary
       only needs to prove the registry + selectStrategy() flow works
       end-to-end on real data.
     - Once bank/NBFC/insurance strategies arrive, they'll force the
       interface to settle, and we can come back and split this one.

   Registers itself on import (industrial is the catch-all and MUST
   be last in the registry).
================================================================ */

import type { RawPeriodData } from "../../types/raw";
import type { RecastPeriod } from "../../types/recast";
import type { ValuationResult } from "../../types/valuation";
import type { EngineConfig } from "../../types/config";
import { processCompanyDataFull } from "../../pipeline";
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

export class IndustrialPipelineStrategy implements PipelineStrategy {
  readonly id = "industrial-v1";
  readonly kind = "industrial" as const;
  readonly version = "1.0.0";

  /** Industrial is the catch-all; matches when nothing else does. */
  matches(_rawData: RawPeriodData[], _config: EngineConfig): boolean {
    void _rawData;
    void _config;
    return true;
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
   * Stage 2: recast. Delegates to the existing pipeline; in this canary
   * we run the full pipeline and discard the auxiliary blocks. PR-3.3+
   * will extract per-stage logic so each call is independent.
   */
  recast(rawData: RawPeriodData[], config: EngineConfig): RecastPeriod[] {
    const result = processCompanyDataFull(rawData, config);
    return result.periods;
  }

  /**
   * Stage 3: ratios live on the RecastPeriod rows produced by recast(),
   * so this method is informational. We mirror them into the strategy
   * surface so consumers can introspect without touching the periods.
   */
  computeRatios(recastData: RecastPeriod[], _config: EngineConfig): SectorRatios {
    void _config;
    const rows: Record<string, unknown> = {};
    for (const p of recastData) {
      if (p.ratios) rows[p.period_end] = p.ratios;
    }
    return { kind: this.kind, rows };
  }

  detectAnomalies(_rawData: RawPeriodData[], recastData: RecastPeriod[]): AnomalyReport {
    void _rawData;
    const flags: string[] = [];
    for (const p of recastData) {
      for (const f of p.spec_flags ?? []) {
        if (f.severity >= 2) flags.push(`${p.period_end}:${f.label}`);
      }
    }
    return { flags, details: { period_count: recastData.length } };
  }

  /**
   * Stage 5: valuation. The canary delegates the full valuation to the
   * existing valuation modules; concrete strategies will call sector-
   * specific lenses directly.
   */
  value(_input: ValuationInput): ValuationResult {
    void _input;
    throw new Error(
      "IndustrialPipelineStrategy.value(): not implemented in canary. Use computeValuation() from PenmanNissimEngine until PR-3.5 lands the orchestrator switch.",
    );
  }

  contributeToEnvelope(_ctx: EnvelopeContext): SectorEnvelopeContribution {
    void _ctx;
    return {
      sectorStatus: { status: "production-ready", reasons: [] },
      sectorBlocks: { strategy: this.id, version: this.version },
    };
  }
}

/** Side-effect: register the industrial strategy on import. */
registerStrategy(new IndustrialPipelineStrategy());
