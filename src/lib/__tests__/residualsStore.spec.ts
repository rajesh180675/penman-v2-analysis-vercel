import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendRunResidualSummary,
  getStoreSizeBytes,
  readResidualHistory,
  RESIDUAL_SCORE_PRODUCTION_THRESHOLD,
  RunResidualSummary,
  __resetResidualsStore,
} from "../residualsStore";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function mkSummary(companyId: string, runIdx: number, score = 10, ts?: string): RunResidualSummary {
  return {
    runId: `${companyId}-run-${runIdx}`,
    timestamp: ts ?? `2026-${String(runIdx + 1).padStart(2, "0")}-01T00:00:00.000Z`,
    companyId,
    schemaVersion: "2026-06-traceability-v14",
    parserResiduals: { unresolvableRowCount: 0, numericParseErrorCount: 0, blankRowRate: 0 },
    mappingResiduals: { unresolvedCriticalCount: 0, unresolvedSupportingCount: 0, conflictCount: 0 },
    identityResiduals: { maxResidualRatio: 0, failedCheckCount: 0 },
    valuationBridgeResiduals: { intrinsicValueSensitivity: 0.05, terminalValueShare: 0.6 },
    overallResidualScore: score,
  };
}

describe("residualsStore", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    __resetResidualsStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("append + read round-trip", () => {
    const s = mkSummary("ITC", 0);
    appendRunResidualSummary(s);
    const history = readResidualHistory("ITC");
    expect(history).toHaveLength(1);
    expect(history[0].runId).toBe("ITC-run-0");
  });

  it("caps per-company history at 100 entries (oldest evicted)", () => {
    for (let i = 0; i < 120; i++) {
      appendRunResidualSummary(mkSummary("ITC", i));
    }
    const history = readResidualHistory("ITC");
    expect(history).toHaveLength(100);
    expect(history[0].runId).toBe("ITC-run-20");
    expect(history[99].runId).toBe("ITC-run-119");
  });

  it("isolates company histories", () => {
    appendRunResidualSummary(mkSummary("ITC", 0));
    appendRunResidualSummary(mkSummary("HDFC", 0));
    expect(readResidualHistory("ITC")).toHaveLength(1);
    expect(readResidualHistory("HDFC")).toHaveLength(1);
    expect(readResidualHistory("ITC")[0].companyId).toBe("ITC");
  });

  it("survives malformed storage entries (returns empty)", () => {
    storage.setItem("penman.residuals.ITC.v1", "not-json{");
    expect(readResidualHistory("ITC")).toEqual([]);
  });

  it("filters non-conforming entries on read", () => {
    storage.setItem(
      "penman.residuals.ITC.v1",
      JSON.stringify([
        mkSummary("ITC", 0),
        { malformed: true },
        mkSummary("ITC", 1),
      ]),
    );
    const entries = readResidualHistory("ITC");
    expect(entries).toHaveLength(2);
  });

  it("getStoreSizeBytes returns the sum of company entries", () => {
    appendRunResidualSummary(mkSummary("ITC", 0));
    appendRunResidualSummary(mkSummary("HDFC", 0));
    const size = getStoreSizeBytes();
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(10000);
  });

  it("readResidualHistory honors limit param", () => {
    for (let i = 0; i < 20; i++) {
      appendRunResidualSummary(mkSummary("ITC", i));
    }
    const lastFive = readResidualHistory("ITC", 5);
    expect(lastFive).toHaveLength(5);
    expect(lastFive[0].runId).toBe("ITC-run-15");
    expect(lastFive[4].runId).toBe("ITC-run-19");
  });

  it("RESIDUAL_SCORE_PRODUCTION_THRESHOLD is 40", () => {
    expect(RESIDUAL_SCORE_PRODUCTION_THRESHOLD).toBe(40);
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => appendRunResidualSummary(mkSummary("ITC", 0))).not.toThrow();
    expect(readResidualHistory("ITC")).toEqual([]);
    expect(getStoreSizeBytes()).toBe(0);
  });

  it("score above threshold is identifiable for the downgrade gate", () => {
    appendRunResidualSummary(mkSummary("ITC", 0, 50));
    const history = readResidualHistory("ITC");
    expect(history[history.length - 1].overallResidualScore).toBeGreaterThan(RESIDUAL_SCORE_PRODUCTION_THRESHOLD);
  });
});
