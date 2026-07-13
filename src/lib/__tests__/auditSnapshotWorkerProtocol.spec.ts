import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../engine/types";
import type { AnalysisSnapshot } from "../auditSnapshotTransport";
import {
  AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
  attachAuditSnapshotWorker,
  type AuditSnapshotWorkerResponse,
} from "../auditSnapshotWorkerProtocol";

describe("audit snapshot worker protocol", () => {
  it("prepares a content-addressed compact artifact response", async () => {
    let listener: ((event: { data: unknown }) => void) | null = null;
    const responses: AuditSnapshotWorkerResponse[] = [];
    const scope = {
      postMessage: (message: AuditSnapshotWorkerResponse) => responses.push(message),
      addEventListener: vi.fn((_type: "message", next: (event: { data: unknown }) => void) => { listener = next; }),
      removeEventListener: vi.fn(),
    };
    const detach = attachAuditSnapshotWorker(scope);
    const snapshot = {
      schemaVersion: "test",
      companyId: "TCS",
      family: "industrial",
      periodCount: 0,
      latestPeriod: null,
      policyVersions: {},
      traceability: {
        schemaVersion: "test",
        generatedAt: "2026-07-12T00:00:00.000Z",
        pipelineStrategyId: "industrial-v1",
        runContext: {},
        policyVersions: {},
        qualityGate: { blockingReasons: [] },
        confidence: { headline: "test" },
        reconciliation: null,
        parserFidelity: null,
        accountingStandardCoverage: null,
        conceptIdentity: null,
        economicSanity: null,
        analyticalDepth: null,
        antiTautology: null,
        lineageRef: null,
        sourceArtifactHashes: [],
        rigor: { currentLevel: "syntactically-valid", currentLabel: "Valid", achievedLevels: [], pendingLevels: [] },
        mappingCoverage: null,
        governance: null,
        analysisContext: { engineError: null },
        backlogPreview: [],
      },
      config: DEFAULT_CONFIG,
      qualityGate: null,
      mappingAudit: null,
      engineError: null,
      debugInfo: null,
      parserDiagnostics: null,
      analysisStatus: null,
      valuationReadiness: null,
      provenanceRows: [],
      granularityChecklist: null,
      rawData: [],
      recastData: [],
      lineage: null,
    } as unknown as AnalysisSnapshot;

    (listener as unknown as (event: { data: unknown }) => void)({ data: {
      protocolVersion: AUDIT_SNAPSHOT_WORKER_PROTOCOL_VERSION,
      type: "audit-snapshot/prepare",
      requestId: "request-1",
      snapshot,
    } });

    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual(expect.objectContaining({
      type: "audit-snapshot/prepared",
      requestId: "request-1",
      result: expect.objectContaining({
        descriptor: expect.objectContaining({ contentHash: expect.any(String) }),
        compactSnapshot: expect.objectContaining({ companyId: "TCS" }),
      }),
    }));
    detach();
    expect(scope.removeEventListener).toHaveBeenCalledOnce();
  });
});
