/* ================================================================
   Plan 9 PR-9.4 — Load test baseline gate contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadBaseline, compareToBaseline } from "../loadTestBaseline";

const baselineJson = readFileSync(
  resolve(__dirname, "../../../docs/load-test-baselines.json"),
  "utf-8",
);

describe("loadBaseline (Plan 9 PR-9.4)", () => {
  it("Parses the shipped baseline file", () => {
    const b = loadBaseline(baselineJson);
    expect(b.version).toMatch(/^2026-/);
    expect(b.endpoints["GET /api/research?action=list-runs"]).toBeDefined();
    expect(b.regressionGate.p95RegressionThreshold).toBe(1.25);
    expect(b.regressionGate.errorRateRegressionThreshold).toBe(0.02);
  });

  it("All endpoints have all three percentile slots + error rate", () => {
    const b = loadBaseline(baselineJson);
    for (const [endpoint, e] of Object.entries(b.endpoints)) {
      expect(typeof e.p50_ms, `${endpoint} p50`).toBe("number");
      expect(typeof e.p95_ms, `${endpoint} p95`).toBe("number");
      expect(typeof e.p99_ms, `${endpoint} p99`).toBe("number");
      expect(typeof e.errorRate, `${endpoint} errorRate`).toBe("number");
    }
  });
});

describe("compareToBaseline (Plan 9 PR-9.4)", () => {
  const baseline = loadBaseline(baselineJson);

  it("Identical measurement passes", () => {
    const measured = [
      {
        endpoint: "GET /api/research?action=list-runs",
        p95_ms: baseline.endpoints["GET /api/research?action=list-runs"]!.p95_ms,
        errorRate: 0.005,
      },
    ];
    const r = compareToBaseline(measured, baseline);
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("p95 regression of 25%+ fails", () => {
    const base = baseline.endpoints["GET /api/research?action=list-runs"]!.p95_ms;
    const measured = [
      {
        endpoint: "GET /api/research?action=list-runs",
        p95_ms: base * 1.5, // +50%
        errorRate: 0.005,
      },
    ];
    const r = compareToBaseline(measured, baseline);
    expect(r.passed).toBe(false);
    expect(r.failures[0]?.metric).toBe("p95");
  });

  it("p95 regression of 20% passes (under 25% gate)", () => {
    const base = baseline.endpoints["GET /api/research?action=list-runs"]!.p95_ms;
    const measured = [
      {
        endpoint: "GET /api/research?action=list-runs",
        p95_ms: base * 1.2,
        errorRate: 0.005,
      },
    ];
    expect(compareToBaseline(measured, baseline).passed).toBe(true);
  });

  it("Error rate above 2% absolute fails", () => {
    const measured = [
      {
        endpoint: "GET /api/research?action=list-runs",
        p95_ms: 100,
        errorRate: 0.05,
      },
    ];
    const r = compareToBaseline(measured, baseline);
    expect(r.passed).toBe(false);
    expect(r.failures[0]?.metric).toBe("errorRate");
  });

  it("Unknown endpoints are skipped (forward compatibility)", () => {
    const measured = [
      { endpoint: "GET /api/research?action=brand-new-action", p95_ms: 99999, errorRate: 1 },
    ];
    expect(compareToBaseline(measured, baseline).passed).toBe(true);
  });

  it("Multiple failures all reported", () => {
    const measured = [
      { endpoint: "GET /api/research?action=list-runs", p95_ms: 10000, errorRate: 0.5 },
    ];
    const r = compareToBaseline(measured, baseline);
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(2);
  });
});
