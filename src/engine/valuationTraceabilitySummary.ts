import { AnalysisRigorLevel, AnalysisTraceabilityEnvelope } from "./analysisTraceability";

export interface ValuationTraceabilitySurfaceSummary {
  headline: string;
  detail: string;
  confidenceLine: string;
  parserLine: string;
  reconciliationLine: string;
  nextGateLine: string;
  blockers: string[];
  /** Plan 5 keystone — present only when the envelope carries the
   *  analyticalDepth block (valuation-time enrichment). Absent on the
   *  structural-only envelopes that the 9 non-valuation surfaces render, so
   *  those surfaces are unaffected. */
  depthLine?: string | undefined;
  /** Schema v19 anti-tautology evidence line. Present only when valuation-time
   *  evidence exists; structural-only envelopes remain unchanged. */
  antiTautologyLine?: string | undefined;
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function formatRigorLevel(level: AnalysisRigorLevel) {
  switch (level) {
    case "syntactically-valid":
      return "Syntactically valid";
    case "structurally-reconciled":
      return "Structurally reconciled";
    case "economically-plausible":
      return "Economically plausible";
    case "valuation-eligible":
      return "Valuation eligible";
    case "production-ready":
      return "Production-ready";
  }
}

function buildAntiTautologyLine(traceability: AnalysisTraceabilityEnvelope): string | undefined {
  const anti = traceability.antiTautology;
  if (!anti) return undefined;
  const holdout = anti.forecastHoldout.status;
  const isolation = anti.priceDerivedIsolation.reverseDcfExcludedFromIntrinsicConfidence
    && anti.priceDerivedIsolation.priceDerivedAssumptionsUsedForIntrinsic === 0
    ? "reverse DCF quarantined"
    : `${anti.priceDerivedIsolation.priceDerivedAssumptionsUsedForIntrinsic} price-derived assumption(s) need review`;
  const sector = anti.sectorDriverCoverage.status === "confirmed"
    ? "sector drivers sourced"
    : anti.sectorDriverCoverage.status === "partial"
      ? `${anti.sectorDriverCoverage.sourceUnavailableCount} sector driver(s) unavailable`
      : "sector drivers unavailable";
  const divergence = anti.paradigmIndependence.criticalDivergence ? "critical lens divergence" : "no critical lens divergence";
  return `${holdout} · ${anti.paradigmIndependence.independentLensCount} independent intrinsic lenses · ${isolation} · ${sector} · ${divergence}`;
}

export function buildValuationTraceabilitySurfaceSummary(
  traceability?: AnalysisTraceabilityEnvelope | null | undefined,
): ValuationTraceabilitySurfaceSummary | null {
  if (!traceability) return null;

  const pendingLevel = traceability.rigor.pendingLevels[0] ?? null;
  const reconciliationCleared =
    traceability.reconciliation.status === "confirmed"
    || traceability.reconciliation.status === "degraded";
  const blockers = Array.from(
    new Set(
      [
        ...(traceability.qualityGate.scopeBlocked || traceability.qualityGate.valuationBlocked
          ? traceability.qualityGate.blockingReasons
          : []),
        traceability.rigor.summary,
        !reconciliationCleared ? traceability.reconciliation.summary : null,
        traceability.parserFidelity.status === "failed" ? traceability.parserFidelity.summary : null,
      ].filter((item): item is string => Boolean(item && item.trim()))
    )
  ).slice(0, 3);

  const valuationGateFailures = [
    traceability.qualityGate.scopeBlocked,
    traceability.qualityGate.valuationBlocked,
    !reconciliationCleared,
    traceability.parserFidelity.status === "failed",
  ].filter(Boolean).length;

  const effectiveBlockingCount = Math.max(
    traceability.confidence.blockingCount,
    valuationGateFailures,
  );

  const effectiveConfidenceStatus = traceability.confidence.status === "blocked" || valuationGateFailures > 0
    ? "blocked"
    : traceability.confidence.status;

  const confidenceLine = effectiveConfidenceStatus === "blocked"
    ? `${effectiveConfidenceStatus} · ${effectiveBlockingCount} gate issue${effectiveBlockingCount === 1 ? "" : "s"}`
    : `${effectiveConfidenceStatus} · ${traceability.confidence.blockingCount} blocking / ${traceability.confidence.diagnosticCount} diagnostic`;

  const depth = traceability.analyticalDepth;
  const depthLine = depth
    ? `${depth.status} · ${depth.presentCount}/4 depth analytics${depth.watchCount > 0 ? ` · ${depth.watchCount} to review` : ""}`
    : undefined;
  const antiTautologyLine = buildAntiTautologyLine(traceability);

  return {
    headline: `${traceability.rigor.currentLabel} · ${traceability.confidence.headline}`,
    detail: traceability.rigor.summary,
    confidenceLine,
    parserLine: `${traceability.parserFidelity.status}${typeof traceability.parserFidelity.score === "number" ? ` · ${traceability.parserFidelity.score}/100` : ""}`,
    reconciliationLine: `${traceability.reconciliation.status} · max residual ${formatPct(traceability.reconciliation.maxResidualRatio)}`,
    nextGateLine: pendingLevel
      ? `Next unresolved gate: ${formatRigorLevel(pendingLevel)}.`
      : "All currently wired rigor gates are cleared.",
    blockers,
    // Conditionally included so structural-only envelopes (the 9 non-valuation
    // surfaces, snapshot/publication) yield a byte-identical summary object.
    ...(depthLine ? { depthLine } : {}),
    ...(antiTautologyLine ? { antiTautologyLine } : {}),
  };
}
