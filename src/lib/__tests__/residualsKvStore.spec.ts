/** @vitest-environment jsdom (browser-storage-backed store) */
/* ================================================================
   Plan 4 PR-4.4 — residualsKvStore contract tests.
================================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import {
  syncResidualHistoryToKv,
  loadResidualHistoryFromKv,
  rehydrateResidualHistoryFromKv,
} from "../residualsKvStore";
import { appendRunResidualSummary, __resetResidualsStore, type RunResidualSummary } from "../residualsStore";
import { setAuthId } from "../identity";

function makeSummary(overrides: Partial<RunResidualSummary> = {}): RunResidualSummary {
  return {
    runId: "run-1",
    companyId: "TEST",
    timestamp: "2026-01-15T10:00:00Z",
    overallResidualScore: 88,
    bsResidualRatio: 0.001,
    cdResidualRatio: 0.0005,
    scResidualRatio: 0.0,
    dfResidualRatio: 0.001,
    isResidualRatio: 0.0008,
    bsCheckCount: 12,
    cdCheckCount: 4,
    scCheckCount: 3,
    dfCheckCount: 5,
    isCheckCount: 8,
    rigorLevel: "production-ready",
    rawData: null,
    ...overrides,
  } as RunResidualSummary;
}

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof document !== "undefined") {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
  __resetResidualsStore();
  setAuthId(null);
});

describe("residualsKvStore (Plan 4 PR-4.4)", () => {
  it("syncResidualHistoryToKv is a no-op when local is empty", async () => {
    await syncResidualHistoryToKv("EMPTY");
    const loaded = await loadResidualHistoryFromKv("EMPTY");
    expect(loaded).toBeNull();
  });

  it("sync + load round-trip preserves entries", async () => {
    appendRunResidualSummary(makeSummary({ runId: "r1" }));
    appendRunResidualSummary(makeSummary({ runId: "r2", timestamp: "2026-01-16T00:00:00Z" }));
    await syncResidualHistoryToKv("TEST");
    const loaded = await loadResidualHistoryFromKv("TEST");
    expect(loaded).not.toBeNull();
    expect(loaded?.map((e) => e.runId)).toEqual(["r1", "r2"]);
  });

  it("loadResidualHistoryFromKv returns null when nothing stored", async () => {
    expect(await loadResidualHistoryFromKv("UNKNOWN")).toBeNull();
  });

  it("rehydrateResidualHistoryFromKv replays entries into local store", async () => {
    appendRunResidualSummary(makeSummary({ runId: "r1" }));
    await syncResidualHistoryToKv("TEST");
    __resetResidualsStore();
    const count = await rehydrateResidualHistoryFromKv("TEST");
    expect(count).toBe(1);
  });

  it("anonymous and authenticated users see separate KV histories per company", async () => {
    appendRunResidualSummary(makeSummary({ runId: "anon-r1" }));
    await syncResidualHistoryToKv("TEST");
    expect(await loadResidualHistoryFromKv("TEST")).toHaveLength(1);

    setAuthId("user-x");
    expect(await loadResidualHistoryFromKv("TEST")).toBeNull();

    appendRunResidualSummary(makeSummary({ runId: "auth-r1" }));
    await syncResidualHistoryToKv("TEST");
    const authHistory = await loadResidualHistoryFromKv("TEST");
    expect(authHistory?.map((e) => e.runId)).toEqual(["anon-r1", "auth-r1"]);

    setAuthId(null);
    const anonHistory = await loadResidualHistoryFromKv("TEST");
    expect(anonHistory?.map((e) => e.runId)).toEqual(["anon-r1"]);
  });
});
