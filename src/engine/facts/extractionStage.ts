/**
 * The fact-extraction stage (migration plan §8.5), as a native stage function.
 *
 * From the parse, the parser's own diagnostics and the source's canonical fact
 * bundle, it produces what the later stages read: the canonical fact set, the
 * parse's fidelity verdict, and the periods the recast reads. Every value it
 * returns is derived from its input alone, so the stage can run apart from the
 * legacy executor and be checked by the same harness.
 *
 * The recast's periods are rebuilt from the recast-line facts when the parse
 * allows it (rawPeriodProjection.ts); otherwise, and when the run has no fact
 * set, they are the parse. The parse itself stays the input of the checks that
 * list or count every label: the quality gate, the mapping audit and parser
 * fidelity.
 */
import type { CapitalineParseDebug } from "../capitalineParser";
import type { SourceParserDiagnostics } from "../parserDiagnostics";
import { evaluateParserFidelity, type ParserFidelitySummary } from "../parserFidelity";
import type { RawPeriodData } from "../types";
import type { FactSet } from "./contracts";
import { adaptLegacyRawPeriodsToFactSet, type LegacyFactAdapterDiagnostic } from "./legacyRawAdapter";
import { canProjectRecastPeriods, projectRecastPeriods } from "./rawPeriodProjection";
import type { CanonicalFactIngestionBundle } from "./sourceAdapters";

export const FACT_EXTRACTION_STAGE_VERSION = "2026-10-fact-extraction-v1" as const;

export interface FactExtractionInput {
  /** The parse, sorted by period, as the run reads it. */
  readonly rawData: readonly RawPeriodData[];
  readonly sourceMode: string;
  readonly debugInfo: CapitalineParseDebug | null;
  readonly parserDiagnostics: SourceParserDiagnostics | null;
  /** The source's fact bundle; without one the run has no fact set. */
  readonly canonicalFacts: CanonicalFactIngestionBundle | null;
}

export interface FactExtractionOutput {
  readonly stageVersion: typeof FACT_EXTRACTION_STAGE_VERSION;
  /** Null without a bundle, or when the bundle's facts could not form a set. */
  readonly factSet: FactSet | null;
  /** Why the bundle's facts formed no set; empty when they did or there was no bundle. */
  readonly blockers: readonly LegacyFactAdapterDiagnostic[];
  readonly parserFidelity: ParserFidelitySummary;
  /** What the recast reads: rebuilt from the facts where the parse allows it, else the parse. */
  readonly recastPeriods: readonly RawPeriodData[];
  readonly recastReadsFacts: boolean;
}

export async function extractRunFacts(input: FactExtractionInput): Promise<FactExtractionOutput> {
  const rawData = [...input.rawData];
  let factSet: FactSet | null = null;
  let blockers: readonly LegacyFactAdapterDiagnostic[] = [];
  if (input.canonicalFacts) {
    const adapted = await adaptLegacyRawPeriodsToFactSet({
      rawData,
      sourceArtifacts: [...input.canonicalFacts.sourceArtifacts],
      periodSources: { ...input.canonicalFacts.periodSources },
      conceptMappings: [...input.canonicalFacts.conceptMappings],
    });
    if (adapted.status === "created") factSet = adapted.factSet;
    else blockers = adapted.diagnostics;
  }
  const parserFidelity = evaluateParserFidelity({
    sourceMode: input.sourceMode,
    rawData,
    debugInfo: input.debugInfo,
    periodCount: rawData.length,
    rawMetricKeyCount: input.debugInfo?.rawMetricKeys.length
      ?? new Set(rawData.flatMap((period) => Object.keys(period.raw_metric_values))).size,
    parserDiagnostics: input.parserDiagnostics,
  });
  const recastReadsFacts = factSet != null && canProjectRecastPeriods(factSet, rawData);
  return {
    stageVersion: FACT_EXTRACTION_STAGE_VERSION,
    factSet,
    blockers,
    parserFidelity,
    recastPeriods: recastReadsFacts ? projectRecastPeriods(factSet!, rawData) : rawData,
    recastReadsFacts,
  };
}
