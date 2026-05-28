/* ================================================================
   Plan 3 PR-3.1 — Pipeline strategy interface (Schema v13 → v14)

   Defines the contract every sector pipeline (industrial, bank,
   NBFC, insurance) will conform to. PR-3.1 ships ONLY the interface
   surface; concrete strategies arrive in PR-3.2 onwards (industrial
   first as the canary).

   Design notes:
     - Strategy + Factory pattern with discriminated `kind`.
     - Each stage of the rigor pipeline is a numbered method so the
       orchestrator can call them in deterministic order.
     - Strategies contribute SECTOR-SPECIFIC envelope blocks; the
       orchestrator owns the COMMON ones (parserFidelity, reconciliation,
       conceptIdentity, etc.). This keeps the strategy surface tight.
     - PR-3.1 deliberately uses minimal placeholder types where the
       cross-strategy union (SectorRatios, SectorStatusBlock) hasn't
       converged yet. Concrete strategy PRs replace these with real
       discriminated unions.
================================================================ */

import type { RawPeriodData } from "../types/raw";
import type { RecastPeriod } from "../types/recast";
import type { ValuationResult } from "../types/valuation";
import type { EngineConfig } from "../types/config";
import type { AnalysisTraceabilityEnvelope } from "../analysisTraceability";

/* ── Sector kind discriminator ─────────────────────────────────── */

export type SectorKind = "industrial" | "bank" | "nbfc" | "insurance";

/* ── Stage I/O placeholder shapes ──────────────────────────────────
   These are intentionally loose in PR-3.1. As each concrete strategy
   lands (PR-3.2 industrial, PR-3.3 bank, PR-3.4 nbfc/insurance), the
   discriminated unions below get tightened with sector-specific row
   shapes. Until then `unknown` keeps the seam honest.
─────────────────────────────────────────────────────────────────── */

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type SectorRatios = {
  kind: SectorKind;
  /** Stage-specific row map; tightened per strategy in PR-3.2+. */
  rows: Record<string, unknown>;
};

export interface AnomalyReport {
  flags: string[];
  details: Record<string, unknown>;
}

export interface ValuationInput {
  recastData: RecastPeriod[];
  config: EngineConfig;
}

export interface SectorStatusBlock {
  status: "production-ready" | "guarded" | "blocked";
  reasons: string[];
}

export interface SectorEnvelopeContribution {
  /** Strategy-specific status block (e.g. bank's CRAR check, NBFC's GNPA gate). */
  sectorStatus: SectorStatusBlock;
  /** Strategy-specific extra blocks merged into the envelope under a sector key. */
  sectorBlocks?: Record<string, unknown>;
}

export interface EnvelopeContext {
  rawData: RawPeriodData[];
  recastData: RecastPeriod[];
  ratios: SectorRatios;
  anomalies: AnomalyReport;
  valuation: ValuationResult | null;
  config: EngineConfig;
  /** Common-fields envelope built by the orchestrator before strategy contribution. */
  envelopeSoFar: Pick<
    AnalysisTraceabilityEnvelope,
    "schemaVersion" | "generatedAt" | "runContext" | "policyVersions"
  >;
}

/* ── The strategy contract ─────────────────────────────────────── */

export interface PipelineStrategy {
  /** Identifier echoed into envelope.pipelineStrategyId for audit. Stable across versions. */
  readonly id: string;
  readonly kind: SectorKind;
  readonly version: string;

  /** Adapter dispatch — does this strategy handle this raw payload + config? */
  matches(rawData: RawPeriodData[], config: EngineConfig): boolean;

  /** Stage 1: ingestion adapter validation (parser already ran). */
  validateRaw(rawData: RawPeriodData[]): ValidationReport;

  /** Stage 2: recast (sort, normalize units, build RecastPeriod). */
  recast(rawData: RawPeriodData[], config: EngineConfig): RecastPeriod[];

  /** Stage 3: ratios + quality scoring (sector-specific). */
  computeRatios(recastData: RecastPeriod[], config: EngineConfig): SectorRatios;

  /** Stage 4: anomaly detection (sector-specific signal set). */
  detectAnomalies(rawData: RawPeriodData[], recastData: RecastPeriod[]): AnomalyReport;

  /** Stage 5: valuation (one or many lenses, sector-specific). */
  value(input: ValuationInput): ValuationResult;

  /** Stage 6: contribute sector-specific blocks to the envelope. Common fields are filled by the orchestrator. */
  contributeToEnvelope(ctx: EnvelopeContext): SectorEnvelopeContribution;
}
