import { AnalysisRigorLevel, AnalysisTraceabilityEnvelope } from "./analysisTraceability";

export interface ValuationTraceabilitySurfaceSummary {
  headline: string;
  detail: string;
  confidenceLine: string;
  parserLine: string;
  reconciliationLine: string;
  nextGateLine: string;
  blockers: string[];
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

export function buildValuationTraceabilitySurfaceSummary(
  traceability?: AnalysisTraceabilityEnvelope | null,
): ValuationTraceabilitySurfaceSummary | null {
  if (!traceability) return null;

  const pendingLevel = traceability.rigor.pendingLevels[0] ?? null;
  const blockers = Array.from(
    new Set(
      [
        ...(traceability.qualityGate.scopeBlocked || traceability.qualityGate.valuationBlocked
          ? traceability.qualityGate.blockingReasons
          : []),
        traceability.rigor.summary,
        traceability.reconciliation.status === "failed" ? traceability.reconciliation.summary : null,
        traceability.parserFidelity.status === "failed" ? traceability.parserFidelity.summary : null,
      ].filter((item): item is string => Boolean(item && item.trim()))
    )
  ).slice(0, 3);

  const valuationGateFailures = [
    traceability.qualityGate.scopeBlocked,
    traceability.qualityGate.valuationBlocked,
    traceability.reconciliation.status === "failed",
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
  };
}
