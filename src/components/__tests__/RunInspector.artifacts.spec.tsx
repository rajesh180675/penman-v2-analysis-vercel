/** @vitest-environment jsdom (mounts through react-dom/client) */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAuditRun } from "../../lib/audit";
import RunInspector from "../RunInspector";

describe("RunInspector artifact integrity", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    rememberAuditRun({
      runId: "run-artifact",
      companyId: "TCS",
      sourceMode: "capitaline",
      fileName: "TCS.zip",
      runAccessToken: "run-token-with-more-than-thirty-two-characters",
      contentClass: "confidential-financial-statements",
      retentionDays: 45,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("automatically verifies a persisted snapshot and renders retention health", async () => {
    const pathname = "audit/artifacts/run-artifact/analysis-snapshot.json.gz";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/audit/inspector")) {
        return new Response(JSON.stringify({
          ok: true,
          runId: "run-artifact",
          latestAt: "2026-07-12T00:00:00.000Z",
          counts: { events: 1, inputs: 1, artifacts: 1 },
          inputs: [],
          artifacts: [{ pathname, uploadedAt: "2026-07-12T00:00:00.000Z", size: 1024, contentType: "application/gzip", contentEncoding: "gzip" }],
          timeline: [],
          health: { severity: "ok", findings: [], recommendations: [], derived: { hasAnalysisReady: true, hasArtifacts: true, hasInputs: true } },
          latestAnalysisSnapshot: null,
          latestMarketSnapshot: null,
          latestValuationSignal: null,
          latestValuationManifest: null,
          latestValuationAlert: null,
          governance: { retentionDays: 45, contentClass: "confidential-financial-statements" },
          retentionHealth: { status: "healthy", mode: "local-opportunistic", lastCheckedAt: "2026-07-12T00:00:00.000Z", expiredRunCount: 0, expiredArtifactCount: 0, orphanCount: 0, summary: "Cleanup is healthy." },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/audit/artifacts")) {
        return new Response(JSON.stringify({
          ok: true,
          artifact: { pathname, filename: "analysis-snapshot.json.gz", contentType: "application/gzip", contentEncoding: "gzip", storedBytes: 1024, uploadedAt: "2026-07-12T00:00:00.000Z" },
          verification: { status: "verified", expectedHash: "abc123", actualHash: "abc123", algorithm: "sha256", decodedBytes: 12_641_273, parsed: true },
          snapshotSummary: { companyId: "TCS", periodCount: 15, latestPeriod: "2026-03-31" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<RunInspector />));
    await vi.waitFor(() => expect(container.textContent).toContain("Integrity: verified"));
    expect(container.textContent).toContain("abc123");
    expect(container.textContent).toContain('"periodCount": 15');
    expect(container.textContent).toContain("Retention cleanup: healthy");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/audit/artifacts"))).toHaveLength(1);
  });
});
