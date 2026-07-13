import { describe, expect, it } from "vitest";
import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import { DEFAULT_CONFIG, type RawPeriodData } from "../../engine/types";
import { buildAnalysisSnapshot } from "../auditSnapshot";
import {
  AUDIT_EVENT_PAYLOAD_BUDGET_BYTES,
  buildCompactAnalysisSnapshot,
  createAnalysisSnapshotArtifact,
  jsonUtf8Bytes,
  type AuditSnapshotArtifactDescriptor,
} from "../auditSnapshotTransport";

const artifactDescriptor: AuditSnapshotArtifactDescriptor = {
  filename: "analysis-snapshot-test.json.gz",
  contentType: "application/gzip",
  contentEncoding: "gzip",
  contentHash: "a".repeat(64),
  contentHashAlgorithm: "sha256",
  uncompressedBytes: 12_641_273,
  storedBytes: 500_000,
  persisted: true,
  pathname: "audit/artifacts/run-tcs/analysis-snapshot-test.json.gz",
};

function baseSnapshot() {
  const rawData: RawPeriodData[] = [{
    company_id: "TCS",
    period_end: "2026-03-31",
    raw_metric_values: { "Revenue__ProfitLoss": 100 },
  }];
  return buildAnalysisSnapshot({
    rawData,
    recastData: null,
    config: { ...DEFAULT_CONFIG, ticker: "TCS", company_type: "it-services" },
    debugInfo: null,
    parserDiagnostics: null,
    qualityGate: null,
    mappingAudit: null,
    engineError: null,
    analysisStatus: null,
    auditMeta: null,
  });
}

describe("audit snapshot transport", () => {
  it("compacts a TCS-sized snapshot below the event budget while retaining the artifact reference", () => {
    const snapshot = baseSnapshot();
    const debugInfo: CapitalineParseDebug = {
      companyId: "TCS",
      files: [{ name: "ProfitLossINDAS_.xls", statementGuess: "ProfitLoss" }],
      detectedPeriods: ["2026-03-31"],
      sourceArtifactHashes: [],
      factOrigins: {
        "2026-03-31": {
          "Revenue__ProfitLoss": { fileName: "ProfitLossINDAS_.xls", parserMethod: "xlsx", row: 1, column: 1 },
        },
      },
      rawGrids: [{
        file: "ProfitLossINDAS_.xls",
        methods: ["xlsx"],
        bestMethod: "xlsx",
        rowCount: 20_000,
        colCount: 30,
        firstRows: [["x".repeat(12_700_000)]],
        headerDetected: true,
        errors: [],
      }],
      metrics: {
        totalCompositeKeys: 1,
        totalBaseKeys: 1,
        baseKeyCollisions: [],
        byStatement: { BalanceSheet: 0, ProfitLoss: 1, CashFlow: 0, Segment: 0, Unknown: 0 },
      },
      warnings: [],
      sample: { firstRows: [] },
      rawMetricKeys: ["Revenue__ProfitLoss"],
    };
    const oversized = { ...snapshot, debugInfo };
    expect(jsonUtf8Bytes(oversized)).toBeGreaterThan(10 * 1024 * 1024);

    const compact = buildCompactAnalysisSnapshot(oversized, artifactDescriptor);

    expect(jsonUtf8Bytes(compact)).toBeLessThanOrEqual(AUDIT_EVENT_PAYLOAD_BUDGET_BYTES);
    expect(compact.artifact).toEqual(artifactDescriptor);
    expect(compact).toHaveProperty("debugInfo.compaction.rawGridCellSamplesOmitted", true);
    expect(compact).toHaveProperty("debugInfo.compaction.factOriginsOmitted", true);
    expect(compact).not.toHaveProperty("recastData");
  });

  it("materializes a content-addressed full snapshot artifact", async () => {
    const snapshot = baseSnapshot();
    const serialized = JSON.stringify(snapshot);
    const artifact = await createAnalysisSnapshotArtifact(snapshot, serialized);

    expect(artifact.descriptor.uncompressedBytes).toBe(new TextEncoder().encode(serialized).byteLength);
    expect(artifact.descriptor.contentHash).toMatch(/^[a-f0-9]{8,64}$/);
    expect(artifact.descriptor.filename).toContain(artifact.descriptor.contentHash.slice(0, 16));
    expect(artifact.blob.size).toBeGreaterThan(0);
  });
});
