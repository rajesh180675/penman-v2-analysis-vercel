import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRegistry } from "../../engine/types";
import {
  fetchSharedComparisonRegistryWithStatus,
  resetSharedRegistryVersionForTests,
  syncSharedComparisonRegistryWithStatus,
} from "../sharedResearchApi";

/**
 * An in-memory stand-in for /api/research?kind=comparison-registry that
 * enforces the same contract as api/research/index.js: a write carrying an
 * `expectedVersion` other than the stored one is refused with 409.
 */
function fakeRegistryServer(initial: CompanyRegistry["companies"] = {}) {
  const state = { version: 0, companies: { ...initial } as Record<string, unknown> };
  const fetchMock = vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "{}");
      if (typeof body.expectedVersion === "number" && body.expectedVersion !== state.version) {
        return { ok: false, status: 409, json: async () => ({ error: "conflict" }) };
      }
      state.version += 1;
      state.companies = body.comparisonRegistry.companies;
      return { ok: true, status: 200, json: async () => ({ ok: true, version: state.version }) };
    }
    expect(path).toBe("/api/research?kind=comparison-registry");
    return {
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: "2026-04-comparison-registry-v1", storedAt: null, companies: state.companies, version: state.version }),
    };
  });
  return { state, fetchMock };
}

function company(id: string) {
  return { id, label: id, rawData: [], recastData: [], traceability: null, companyType: null, sector: null };
}

describe("shared comparison registry optimistic concurrency", () => {
  beforeEach(() => resetSharedRegistryVersionForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the version it last read and advances it after a write", async () => {
    const server = fakeRegistryServer();
    vi.stubGlobal("fetch", server.fetchMock);
    await fetchSharedComparisonRegistryWithStatus();
    await syncSharedComparisonRegistryWithStatus({ companies: { TCS: company("TCS") } });
    await syncSharedComparisonRegistryWithStatus({ companies: { TCS: company("TCS"), INFY: company("INFY") } });
    const bodies = server.fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(init!.body!));
    expect(bodies.map((b) => b.expectedVersion)).toEqual([0, 1]);
    expect(server.state.version).toBe(2);
  });

  it("does not drop another tab's company: a stale write re-reads, merges and retries", async () => {
    const server = fakeRegistryServer();
    vi.stubGlobal("fetch", server.fetchMock);
    // This tab read version 0 …
    await fetchSharedComparisonRegistryWithStatus();
    // … then another tab added HDFC (version 1) behind its back.
    server.state.version = 1;
    server.state.companies = { HDFC: company("HDFC") };

    const result = await syncSharedComparisonRegistryWithStatus({ companies: { TCS: company("TCS") } });

    expect(result.ok).toBe(true);
    // Before: this write replaced the registry wholesale and HDFC vanished.
    expect(Object.keys(server.state.companies).sort()).toEqual(["HDFC", "TCS"]);
    expect(server.state.version).toBe(2);
  });
});
