/* Pure type leaf — analysis traceability envelope (the shared trust signal).
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Imports summary types ONLY from pure leaves + acyclic policyVersions/lineageTypes.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

import type { ParserFidelitySummary } from "./parserFidelity";
import type { ReconciliationResidualSummary } from "./reconciliation";
import type { ConceptIdentitySummary } from "./conceptIdentity";
import type { EconomicSanitySummary } from "./economicSanity";
import type { UnusualItemManifest } from "./unusualItem";
import type { AnalyticalDepthSummary } from "./analyticalDepth";
import type { AntiTautologySummary } from "../valuationEvidence/types";
import type { AnalysisPolicyVersions } from "../policyVersions";
import type { LineageRef } from "../lineageTypes";
import type { SourceArtifactHash } from "../capitalineParser/types";
import type { BacklogTriageAction, BacklogPriority } from "./backlog";

/**
 * Phase A6 — multi-standard ingestion provenance surfaced in the
 * traceability envelope. Tracks how many periods came from each
 * accounting standard so downstream UI / rigor checks can flag runs
 * that lean on lower-confidence (pre-Ind-AS) data.
 */
export type AccountingStandardLabel =
  | "ind-as"
  | "revised-sch-vi"
  | "standard"
  | "unknown";

export interface AccountingStandardCoverage {
  /** Standard with the most periods. Falls back to "unknown" when raw
   *  data carries no provenance (legacy fixtures, screener imports). */
  dominantStandard: AccountingStandardLabel;
  /** Period count per standard. */
  periodsByStandard: Record<AccountingStandardLabel, number>;
  /** Periods whose dominant standard is non-Ind-AS (medium/low confidence). */
  preIndASPeriods: number;
  /** True when ≥2 distinct standards contributed periods. */
  hasMultiStandardData: boolean;
  /** Confidence band: "high" when all periods are Ind-AS, "medium" with
   *  Revised-Sch-VI present, "low" for older-Standard or Unknown periods,
   *  "unknown" when raw data has no accounting_standard tag at all. */
  confidence: "high" | "medium" | "low" | "unknown";
}

export type AnalysisRigorLevel =
  | "syntactically-valid"
  | "structurally-reconciled"
  | "economically-plausible"
  | "valuation-eligible"
  | "production-ready";

export interface AnalysisRigorCheckpoint {
  level: AnalysisRigorLevel;
  label: string;
  achieved: boolean;
  detail: string;
}

export interface TraceabilityBacklogPreview {
  statement: string;
  key: string;
  action: BacklogTriageAction;
  priority: BacklogPriority;
  periodsObserved: number;
  latestValue: number | null;
}

export interface AnalysisTraceabilityEnvelope {
  schemaVersion: string;
  generatedAt: string | null;
  /**
   * Plan 3 PR-3.1 — Identifier of the pipeline strategy that produced
   * this envelope. Stable across versions so an audit can reproduce
   * the run with the same code path. Optional in v14 (registry empty
   * until PR-3.2); becomes required in v15 once strategies are wired.
   */
  pipelineStrategyId?: string | undefined;
  runContext: {
    runId: string | null;
    companyId: string | null;
    sourceMode: string | null;
    periodCount: number;
    latestPeriod: string | null;
  };
  policyVersions: AnalysisPolicyVersions;
  qualityGate: {
    tier: "Tier 1" | "Tier 2" | "Tier 3" | "Unknown";
    valuationBlocked: boolean;
    blockingReasons: string[];
    scopeClassification: string | null;
    scopeBlocked: boolean;
  };
  confidence: {
    status: "production-ready" | "guarded" | "blocked";
    headline: string;
    tone: "emerald" | "amber" | "red";
    blockingCount: number;
    diagnosticCount: number;
    optionalCount: number;
  };
  parserFidelity: ParserFidelitySummary;
  reconciliation: ReconciliationResidualSummary;
  /** Phase A6 — distribution of accounting standards across raw periods. */
  accountingStandardCoverage: AccountingStandardCoverage;
  /** Gap 1 / PR-A — concept identity layer. Surfaces conflicts between the
   *  canonical concept registry and the raw labels resolved by the run.
   *  When `status === "valuation-blocked"` and the
   *  `rigor.conceptIdentityBlock` feature flag is on, the run cannot
   *  reach `valuation-eligible`. */
  conceptIdentity: ConceptIdentitySummary;
  /** Gap 2 / PR-B — economic sanity gates. Surfaces the deterministic
   *  anchor period selection (latest period that passes block-severity
   *  checks within MAX_ANCHOR_LOOKBACK_PERIODS), skipped contaminated
   *  periods, and the per-check verdicts. When `status === "blocked"`
   *  and the `rigor.economicSanityBlock` flag is on, the run cannot
   *  reach `economically-plausible`. */
  economicSanity: EconomicSanitySummary;
  /** Gap 3 / PR-C — unusual-item taxonomy. Each raw label classified as
   *  "exceptional / extraordinary / unusual" by the parser is matched
   *  against an ordered set of regex rules and emitted as a manifest
   *  entry with rationale. `terminalEligibilityBlocked` flips when any
   *  classification has `affectsTerminalEligibility: true`, which feeds
   *  back into Gap 2's terminal-period contamination check. */
  unusualItemManifest: UnusualItemManifest;
  /** Plan 5 keystone (schema v18) — analytical-depth read-out: how much
   *  valuation depth the run exercised (reverse-DCF plausibility, clean-surplus,
   *  Damodaran CAPM ke cross-check, SOTP). Populated at valuation time by the
   *  surface enricher (`evaluateAnalyticalDepth`); the structural builder
   *  (`buildAnalysisTraceability`) leaves it absent because valuation output is
   *  not in scope there. Optional + nullable so non-valuation surfaces, the
   *  snapshot/publication paths, and migrated legacy envelopes are unaffected. */
  analyticalDepth?: AnalyticalDepthSummary | null | undefined;
  /** Schema v19 anti-tautology evidence summary. Populated at valuation time
   *  when command-center evidence exists; structural-only envelopes and legacy
   *  migrations carry null/absent to avoid pretending valuation evidence ran. */
  antiTautology?: AntiTautologySummary | null | undefined;
  /** Gap 4 / PR-D — per-number lineage REFERENCE (not the data itself).
   *  Lineage payload lives in the audit snapshot sidecar to keep
   *  envelope JSON serialization bounded. The ref carries a checksum
   *  so a future reader can detect drift between envelope and
   *  snapshot. See ADR-004. */
  lineageRef: LineageRef;
  /** Source-lineage — SHA-256 hashes of each source artifact (.xls file)
   *  inside the parsed ZIP. Empty for manual entry / JSON import runs.
   *  Lets the production-ready checkpoint verify source provenance without
   *  requiring the CLI audit harness to run separately. */
  sourceArtifactHashes?: SourceArtifactHash[] | null | undefined;
  rigor: {
    currentLevel: AnalysisRigorLevel;
    currentLabel: string;
    summary: string;
    achievedLevels: AnalysisRigorLevel[];
    pendingLevels: AnalysisRigorLevel[];
    checkpoints: AnalysisRigorCheckpoint[];
  };
  mappingCoverage: {
    unresolvedBySeverity: Record<"critical" | "warning" | "info", number>;
    unresolvedByTier: Record<"Tier A" | "Tier B" | "Tier C" | "Tier D", number>;
    outOfSpecLabelCount: number;
    actionableOutOfSpecLabelCount: number;
    backlogByAction: Record<"add-to-spec" | "group-to-existing" | "ignore-non-core" | "review", number>;
  };
  governance: {
    contentClass: string | null;
    retentionDays: number | null;
    runInspectorEnabled: boolean | null;
  };
  analysisContext: {
    rawPeriodCount: number;
    recastPeriodCount: number;
    hasRecastData: boolean;
    hasDebugInfo: boolean;
    debugFiles: number;
    rawMetricKeyCount: number;
    engineError: string | null;
  };
  backlogPreview: TraceabilityBacklogPreview[];
}
