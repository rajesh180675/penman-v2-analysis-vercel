import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type EngineConfig, type RawPeriodData } from "../../engine/types";
import type { AnalysisStatusSummary } from "../../engine/analysisStatus";

const mocks = vi.hoisted(() => ({
  persistAuditBlob: vi.fn(async (_input: { eventType: string }) => ({ path: "audit/artifacts/run-1/snapshot.json" })),
  persistAuditEvent: vi.fn(async (_input: { eventType: string }) => ({ ok: true })),
  buildAnalysisSnapshot: vi.fn((input: unknown) => input),
  prepareAnalysisSnapshotOffThread: vi.fn(async () => ({
    blob: new Blob(["snapshot"], { type: "application/json" }),
    descriptor: {
      filename: "snapshot.json",
      contentType: "application/json",
      contentEncoding: null,
      contentHash: "a".repeat(64),
      contentHashAlgorithm: "sha256",
      uncompressedBytes: 8,
      storedBytes: 8,
      persisted: false,
      pathname: null,
    },
    compactSnapshot: { schemaVersion: "compact-v1", artifact: null },
  })),
  attachPersistedArtifactDescriptor: vi.fn((snapshot: object, descriptor: object) => ({ ...snapshot, artifact: descriptor })),
}));

vi.mock("../../lib/audit", () => ({
  persistAuditBlob: mocks.persistAuditBlob,
  persistAuditEvent: mocks.persistAuditEvent,
}));
vi.mock("../../lib/auditSnapshot", () => ({ buildAnalysisSnapshot: mocks.buildAnalysisSnapshot }));
vi.mock("../../lib/auditSnapshotTransport", () => ({
  attachPersistedArtifactDescriptor: mocks.attachPersistedArtifactDescriptor,
}));
vi.mock("../../lib/auditSnapshotWorkerClient", () => ({
  prepareAnalysisSnapshotOffThread: mocks.prepareAnalysisSnapshotOffThread,
}));

import { AUDIT_SNAPSHOT_DEBOUNCE_MS, useAuditPersistence } from "../useAuditPersistence";

const rawData: RawPeriodData[] = [{ company_id: "TCS", period_end: "2026-03-31", raw_metric_values: { revenue: 1 } }];
const analysisStatus: AnalysisStatusSummary = {
  status: "guarded",
  label: "Guarded",
  headline: "Guarded",
  summary: "Guarded",
  reasons: [],
  tone: "amber",
  qualityTier: "Tier 2",
  valuationStatus: "guarded",
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

function Harness({ config }: { config: EngineConfig }) {
  useAuditPersistence({
    auditMeta: {
      runId: "run-1",
      companyId: "TCS",
      sourceMode: "capitaline",
      fileName: "TCS.zip",
      runAccessToken: "token",
      contentClass: "confidential-financial-statements",
      retentionDays: 45,
    },
    rawData,
    recastData: null,
    config,
    debugInfo: null,
    parserDiagnostics: null,
    qualityGate: null,
    mappingAudit: null,
    engineError: null,
    analysisStatus,
    activeTab: "upload",
  });
  return null;
}

describe("useAuditPersistence snapshot coalescing", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(mocks).forEach((mock) => mock.mockClear());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("persists only the latest snapshot after rapid config changes", async () => {
    await act(async () => root.render(<Harness config={{ ...DEFAULT_CONFIG, ticker: "FIRST" }} />));
    await act(async () => root.render(<Harness config={{ ...DEFAULT_CONFIG, ticker: "TCS" }} />));
    await act(async () => vi.advanceTimersByTimeAsync(AUDIT_SNAPSHOT_DEBOUNCE_MS - 1));
    expect(mocks.persistAuditBlob).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    await vi.waitFor(() => expect(mocks.persistAuditBlob).toHaveBeenCalledTimes(1));
    expect(mocks.buildAnalysisSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.buildAnalysisSnapshot.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ config: expect.objectContaining({ ticker: "TCS" }) }));
    expect(mocks.persistAuditEvent.mock.calls.filter(([input]) => input.eventType === "analysis-snapshot")).toHaveLength(1);
  });
});
