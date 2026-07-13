import type { buildAnalysisSnapshot } from "./auditSnapshot";

export const AUDIT_EVENT_PAYLOAD_BUDGET_BYTES = 900 * 1024;

export interface AuditSnapshotArtifactDescriptor {
  filename: string;
  contentType: "application/gzip" | "application/json";
  contentEncoding: "gzip" | null;
  contentHash: string;
  contentHashAlgorithm: "sha256" | "fnv1a32-fallback";
  uncompressedBytes: number;
  storedBytes: number;
  persisted: boolean;
  pathname: string | null;
}

export type AnalysisSnapshot = ReturnType<typeof buildAnalysisSnapshot>;

export interface PreparedAnalysisSnapshotTransport {
  blob: Blob;
  descriptor: AuditSnapshotArtifactDescriptor;
  compactSnapshot: ReturnType<typeof buildCompactAnalysisSnapshot>;
}

export function jsonUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function uniqueRawMetricKeys(snapshot: AnalysisSnapshot, limit: number): { keys: string[]; total: number } {
  const keys = new Set<string>();
  for (const period of snapshot.rawData ?? []) {
    for (const key of Object.keys(period.raw_metric_values ?? {})) keys.add(key);
  }
  const sorted = [...keys].sort();
  return { keys: sorted.slice(0, limit), total: sorted.length };
}

function compactDebugInfo(snapshot: AnalysisSnapshot, aggressive: boolean) {
  const debug = snapshot.debugInfo;
  if (!debug) return null;
  const rawMetricKeyLimit = aggressive ? 200 : 1_000;
  const factOriginCount = Object.values(debug.factOrigins ?? {})
    .reduce((count, origins) => count + Object.keys(origins).length, 0);
  return {
    companyId: debug.companyId,
    files: debug.files,
    detectedPeriods: debug.detectedPeriods,
    sourceArtifactHashes: debug.sourceArtifactHashes,
    rawGrids: debug.rawGrids.map((grid) => ({
      file: grid.file,
      methods: grid.methods,
      bestMethod: grid.bestMethod,
      rowCount: grid.rowCount,
      colCount: grid.colCount,
      headerDetected: grid.headerDetected,
      headerRowIndex: grid.headerRowIndex,
      periodLabels: grid.periodLabels,
      errors: grid.errors.slice(0, 20),
    })),
    metrics: debug.metrics,
    warnings: debug.warnings.slice(0, aggressive ? 25 : 100),
    sample: {
      headerRow: debug.sample.headerRow?.slice(0, 100),
      firstRows: debug.sample.firstRows.slice(0, aggressive ? 3 : 10),
    },
    rawMetricKeys: debug.rawMetricKeys.slice(0, rawMetricKeyLimit),
    compaction: {
      rawMetricKeyCount: debug.rawMetricKeys.length,
      factOriginCount,
      rawGridCellSamplesOmitted: true,
      factOriginsOmitted: true,
    },
  };
}

function compactMappingAudit(snapshot: AnalysisSnapshot, aggressive: boolean) {
  const report = snapshot.mappingAudit;
  if (!report) return null;
  const primaryLimit = aggressive ? 100 : 500;
  const suggestionLimit = aggressive ? 25 : 100;
  return {
    mappingSpecVersion: report.mappingSpecVersion,
    policyVersion: report.policyVersion,
    usedKeysNotInYaml: report.usedKeysNotInYaml.slice(0, primaryLimit),
    yamlKeysNotInDataset: report.yamlKeysNotInDataset.slice(0, primaryLimit),
    unresolvedCriticalByStatement: report.unresolvedCriticalByStatement,
    datasetKeyCounts: report.datasetKeyCounts,
    coverageSummary: report.coverageSummary,
    outOfSpecLabels: report.outOfSpecLabels.slice(0, primaryLimit),
    backlogSummary: report.backlogSummary,
    clusterSuggestions: {
      clusters: report.clusterSuggestions.clusters.slice(0, suggestionLimit),
      unclustered: report.clusterSuggestions.unclustered.slice(0, suggestionLimit),
      stats: report.clusterSuggestions.stats,
    },
    correlationSuggestions: report.correlationSuggestions.slice(0, suggestionLimit),
    promotionCandidates: report.promotionCandidates.slice(0, suggestionLimit),
    compaction: {
      outOfSpecLabelCount: report.outOfSpecLabels.length,
      usedKeysNotInYamlCount: report.usedKeysNotInYaml.length,
      yamlKeysNotInDatasetCount: report.yamlKeysNotInDataset.length,
      clusterSuggestionCount: report.clusterSuggestions.clusters.length,
      correlationSuggestionCount: report.correlationSuggestions.length,
      promotionCandidateCount: report.promotionCandidates.length,
    },
  };
}

function compactTraceability(snapshot: AnalysisSnapshot) {
  const trace = snapshot.traceability;
  return {
    schemaVersion: trace.schemaVersion,
    generatedAt: trace.generatedAt,
    pipelineStrategyId: trace.pipelineStrategyId,
    runContext: trace.runContext,
    policyVersions: trace.policyVersions,
    qualityGate: trace.qualityGate,
    confidence: trace.confidence,
    parserFidelity: trace.parserFidelity,
    reconciliation: trace.reconciliation,
    accountingStandardCoverage: trace.accountingStandardCoverage,
    conceptIdentity: trace.conceptIdentity,
    economicSanity: trace.economicSanity,
    analyticalDepth: trace.analyticalDepth,
    antiTautology: trace.antiTautology,
    lineageRef: trace.lineageRef,
    sourceArtifactHashes: trace.sourceArtifactHashes,
    rigor: trace.rigor,
    mappingCoverage: trace.mappingCoverage,
    governance: trace.governance,
    analysisContext: trace.analysisContext,
    backlogPreview: trace.backlogPreview.slice(0, 50),
    compaction: { unusualItemManifestStoredInArtifact: true },
  };
}

function buildCandidate(
  snapshot: AnalysisSnapshot,
  artifact: AuditSnapshotArtifactDescriptor,
  aggressive: boolean,
) {
  const rawMetricIndex = uniqueRawMetricKeys(snapshot, aggressive ? 1_000 : 5_000);
  const lineageRecord = snapshot.lineage && typeof snapshot.lineage === "object" ? snapshot.lineage : {};
  return {
    schemaVersion: "analysis-snapshot-event-v2",
    companyId: snapshot.companyId,
    family: snapshot.family,
    periodCount: snapshot.periodCount,
    latestPeriod: snapshot.latestPeriod,
    policyVersions: snapshot.policyVersions,
    traceability: aggressive ? compactTraceability(snapshot) : snapshot.traceability,
    config: snapshot.config,
    qualityGate: snapshot.qualityGate,
    mappingAudit: compactMappingAudit(snapshot, aggressive),
    engineError: snapshot.engineError,
    debugInfo: compactDebugInfo(snapshot, aggressive),
    parserDiagnostics: snapshot.parserDiagnostics,
    analysisStatus: snapshot.analysisStatus,
    valuationReadiness: snapshot.valuationReadiness,
    provenanceRows: snapshot.provenanceRows.slice(0, aggressive ? 50 : 250),
    granularityChecklist: aggressive ? null : snapshot.granularityChecklist,
    rawMetricKeyIndex: rawMetricIndex.keys,
    rawDataSummary: {
      periodCount: snapshot.rawData?.length ?? 0,
      periods: (snapshot.rawData ?? []).map((period) => ({
        companyId: period.company_id,
        periodEnd: period.period_end,
        metricCount: Object.keys(period.raw_metric_values ?? {}).length,
      })),
      rawMetricKeyCount: rawMetricIndex.total,
    },
    recastDataSummary: {
      periodCount: snapshot.recastData?.length ?? 0,
      periods: (snapshot.recastData ?? []).map((period) => period.period_end),
    },
    lineageSummary: {
      topLevelEntryCount: Object.keys(lineageRecord).length,
    },
    artifact,
    compaction: {
      eventPayloadBudgetBytes: AUDIT_EVENT_PAYLOAD_BUDGET_BYTES,
      fullRawDataStoredInArtifact: true,
      fullRecastDataStoredInArtifact: true,
      fullLineageStoredInArtifact: true,
      fullDebugGridsStoredInArtifact: true,
      aggressive,
    },
  };
}

/**
 * Produces the bounded timeline/backlog representation of an analysis snapshot.
 * The complete snapshot is stored separately as an artifact and referenced here.
 */
export function buildCompactAnalysisSnapshot(
  snapshot: AnalysisSnapshot,
  artifact: AuditSnapshotArtifactDescriptor,
) {
  const standard = buildCandidate(snapshot, artifact, false);
  if (jsonUtf8Bytes(standard) <= AUDIT_EVENT_PAYLOAD_BUDGET_BYTES) return standard;

  const aggressive = buildCandidate(snapshot, artifact, true);
  if (jsonUtf8Bytes(aggressive) <= AUDIT_EVENT_PAYLOAD_BUDGET_BYTES) return aggressive;

  const emergency = {
    schemaVersion: "analysis-snapshot-event-v2",
    companyId: snapshot.companyId,
    family: snapshot.family,
    periodCount: snapshot.periodCount,
    latestPeriod: snapshot.latestPeriod,
    policyVersions: snapshot.policyVersions,
    traceability: compactTraceability(snapshot),
    analysisStatus: snapshot.analysisStatus,
    valuationReadiness: snapshot.valuationReadiness,
    mappingAudit: compactMappingAudit(snapshot, true),
    artifact,
    compaction: {
      eventPayloadBudgetBytes: AUDIT_EVENT_PAYLOAD_BUDGET_BYTES,
      fullSnapshotStoredInArtifact: true,
      aggressive: true,
      emergencySummary: true,
    },
  };
  if (jsonUtf8Bytes(emergency) <= AUDIT_EVENT_PAYLOAD_BUDGET_BYTES) return emergency;

  // Absolute transport guard for pathological diagnostics. The content-
  // addressed artifact remains the source of full-fidelity evidence.
  return {
    schemaVersion: "analysis-snapshot-event-v2",
    companyId: snapshot.companyId,
    family: snapshot.family,
    periodCount: snapshot.periodCount,
    latestPeriod: snapshot.latestPeriod,
    policyVersions: snapshot.policyVersions,
    traceability: {
      schemaVersion: snapshot.traceability.schemaVersion,
      generatedAt: snapshot.traceability.generatedAt,
      runContext: snapshot.traceability.runContext,
      policyVersions: snapshot.traceability.policyVersions,
      qualityGate: {
        ...snapshot.traceability.qualityGate,
        blockingReasons: snapshot.traceability.qualityGate.blockingReasons.slice(0, 20).map((reason) => reason.slice(0, 500)),
      },
      confidence: {
        ...snapshot.traceability.confidence,
        headline: snapshot.traceability.confidence.headline.slice(0, 500),
      },
      mappingCoverage: snapshot.traceability.mappingCoverage,
      analysisContext: {
        ...snapshot.traceability.analysisContext,
        engineError: snapshot.traceability.analysisContext.engineError?.slice(0, 2_000) ?? null,
      },
      rigor: {
        currentLevel: snapshot.traceability.rigor.currentLevel,
        currentLabel: snapshot.traceability.rigor.currentLabel.slice(0, 200),
        achievedLevels: snapshot.traceability.rigor.achievedLevels,
        pendingLevels: snapshot.traceability.rigor.pendingLevels,
      },
    },
    artifact,
    compaction: {
      eventPayloadBudgetBytes: AUDIT_EVENT_PAYLOAD_BUDGET_BYTES,
      fullSnapshotStoredInArtifact: true,
      aggressive: true,
      artifactOnlySummary: true,
    },
  };
}

function fallbackFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function contentHash(bytes: Uint8Array): Promise<{
  hash: string;
  algorithm: AuditSnapshotArtifactDescriptor["contentHashAlgorithm"];
}> {
  if (globalThis.crypto?.subtle) {
    try {
      const digestInput = new Uint8Array(bytes.byteLength);
      digestInput.set(bytes);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput.buffer);
      return {
        hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        algorithm: "sha256",
      };
    } catch {
      // Older/instrumented browsers can expose SubtleCrypto but reject the
      // operation. The fallback remains deterministic and is labelled as such.
    }
  }
  return { hash: fallbackFingerprint(bytes), algorithm: "fnv1a32-fallback" };
}

export async function createAnalysisSnapshotArtifact(
  snapshot: AnalysisSnapshot,
  serialized = JSON.stringify(snapshot),
): Promise<{ blob: Blob; descriptor: AuditSnapshotArtifactDescriptor }> {
  const bytes = new TextEncoder().encode(serialized);
  const digest = await contentHash(bytes);
  const sourceBlob = new Blob([serialized], { type: "application/json" });
  const canGzip = typeof CompressionStream !== "undefined" && typeof sourceBlob.stream === "function";
  let blob: Blob;
  if (canGzip) {
    try {
      const compressed = sourceBlob.stream()
        .pipeThrough(new CompressionStream("gzip"));
      blob = new Blob([await new Response(compressed).arrayBuffer()], { type: "application/gzip" });
    } catch {
      blob = sourceBlob;
    }
  } else {
    blob = sourceBlob;
  }
  const gzipApplied = blob.type === "application/gzip";
  const suffix = gzipApplied ? ".json.gz" : ".json";
  return {
    blob,
    descriptor: {
      filename: `analysis-snapshot-${digest.hash.slice(0, 16)}${suffix}`,
      contentType: gzipApplied ? "application/gzip" : "application/json",
      contentEncoding: gzipApplied ? "gzip" : null,
      contentHash: digest.hash,
      contentHashAlgorithm: digest.algorithm,
      uncompressedBytes: bytes.byteLength,
      storedBytes: blob.size,
      persisted: false,
      pathname: null,
    },
  };
}

/**
 * Performs every size-proportional transport operation in one callable unit.
 * The browser worker invokes this function so JSON serialization, hashing,
 * gzip compression, and compact-event sizing do not block React rendering.
 */
export async function prepareAnalysisSnapshotTransport(
  snapshot: AnalysisSnapshot,
): Promise<PreparedAnalysisSnapshotTransport> {
  const artifact = await createAnalysisSnapshotArtifact(snapshot);
  return {
    ...artifact,
    compactSnapshot: buildCompactAnalysisSnapshot(snapshot, artifact.descriptor),
  };
}

export function attachPersistedArtifactDescriptor(
  compactSnapshot: PreparedAnalysisSnapshotTransport["compactSnapshot"],
  descriptor: AuditSnapshotArtifactDescriptor,
): PreparedAnalysisSnapshotTransport["compactSnapshot"] {
  return { ...compactSnapshot, artifact: descriptor } as PreparedAnalysisSnapshotTransport["compactSnapshot"];
}
