import type {
  AntiTautologySummary,
  EvidenceWeightedValuationSynthesis,
  ForecastHoldoutSummary,
  ValuationEvidenceLedger,
} from "./types";

function simpleChecksum(input: unknown): string {
  const text = JSON.stringify(input ?? null);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function summarizeAntiTautology(commandCenter: {
  evidenceLedger: ValuationEvidenceLedger;
  forecastHoldout: ForecastHoldoutSummary;
  evidenceWeightedSynthesis: EvidenceWeightedValuationSynthesis;
}): AntiTautologySummary {
  const ledger = commandCenter.evidenceLedger;
  const holdout = commandCenter.forecastHoldout;
  const synthesis = commandCenter.evidenceWeightedSynthesis;
  const priceDerivedAssumptionsUsedForIntrinsic = ledger.rows.filter((row) => row.priceDerived && row.eligibleForIntrinsicConfidence).length;
  const legacyIndependentLensCount = new Set(
    synthesis.contributions
      .filter((item) => item.includedInIntrinsicRange && item.finalWeight > 0)
      .map((item) => item.independenceGroup),
  ).size;
  const includedValues = synthesis.contributions
    .filter((item) => item.includedInIntrinsicRange && item.perShare != null && item.perShare > 0)
    .map((item) => item.perShare!);
  const legacyCriticalDivergence = includedValues.length >= 2
    ? (Math.max(...includedValues) - Math.min(...includedValues)) / Math.max(1, synthesis.intrinsicRange.midPerShare ?? includedValues[0]!) > 0.5
    : false;
  const sectorUnavailable = ledger.rows.filter((row) => row.independenceGroup === "operational-driver" && row.sourceType === "source-unavailable").length;
  const sectorDriverRows = ledger.rows.filter((row) => row.independenceGroup === "operational-driver");

  return {
    evidenceLedgerRef: {
      hasLedger: ledger.rows.length > 0,
      assumptionCount: ledger.summary.total,
      unsupportedCount: ledger.summary.unsupportedCount,
      priceDerivedCount: ledger.summary.priceDerivedCount,
      checksum: ledger.rows.length ? simpleChecksum(ledger) : null,
    },
    forecastHoldout: {
      available: holdout.available,
      status: holdout.aggregate.status,
      weightedMape: holdout.aggregate.weightedMape,
      valuationRangeWideningPct: holdout.aggregate.valuationRangeWideningPct,
      calibrationStatus: holdout.aggregate.calibrationStatus,
      sampleSize: holdout.aggregate.sampleSize,
      benchmarkSkill: holdout.aggregate.benchmark?.skillVsBenchmark ?? null,
      noLookAheadStatus: holdout.aggregate.noLookAhead?.status,
    },
    priceDerivedIsolation: {
      reverseDcfExcludedFromIntrinsicConfidence: synthesis.contributions.find((item) => item.modelKey === "reverse-dcf")?.includedInIntrinsicRange === false,
      priceDerivedAssumptionsUsedForIntrinsic,
    },
    paradigmIndependence: {
      independentLensCount: synthesis.independenceDiagnostics?.independentGroupCount ?? legacyIndependentLensCount,
      criticalDivergence: synthesis.independenceDiagnostics?.criticalDivergence ?? legacyCriticalDivergence,
    },
    sectorDriverCoverage: {
      status: sectorDriverRows.length === 0 ? "unavailable" : sectorUnavailable === 0 ? "confirmed" : "partial",
      driverCount: sectorDriverRows.length,
      sourceUnavailableCount: sectorUnavailable,
    },
  };
}
