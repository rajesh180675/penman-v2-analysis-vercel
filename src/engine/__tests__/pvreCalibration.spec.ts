/**
 * PVRE Milestone C — calibration scoring + snapshot persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scorePvreCalibration } from "../pvre/calibration";
import { buildSnapshot, persistSnapshot, loadSnapshots, snapshotFilename } from "../../../scripts/pvre/persistence";
import type { PvreOutput } from "../pvre/types";

function fakePvre(q05: number, q50: number, q95: number): PvreOutput {
  return {
    status: "ok",
    seed: 1,
    iterations: 100,
    intrinsic: { q05, q25: (q05 + q50) / 2, q50, q75: (q50 + q95) / 2, q95, mean: q50, stdev: 1, n: 100 },
    perModel: [],
    disagreement: null,
    probabilityUndervalued: null,
    uncertaintyWidthRatio: null,
    referencePrice: null,
    meta: { sampledKeys: [], constrainedTo: "configured-ranges-and-bands", companiesType: null },
  };
}

describe("PVRE calibration scoring", () => {
  it("insufficient-data when fewer than 4 valid rows", () => {
    const score = scorePvreCalibration([
      { asOfDate: "2024-01-01", marketPrice: 100, pvre: fakePvre(80, 100, 120) },
      { asOfDate: "2024-02-01", marketPrice: 100, pvre: fakePvre(80, 100, 120) },
    ]);
    expect(score.label).toBe("insufficient-data");
    expect(score.coverage80).toBeNull();
  });

  it("labels well-calibrated when coverage80 ≈ 80%", () => {
    const rows = [];
    // 10 vintages; market price in-CI for 8 → coverage 0.8 = perfect
    for (let i = 0; i < 10; i += 1) {
      const price = i < 8 ? (80 + i * 4) : (i === 9 ? 200 : 10); // 8 inside [80,120], 2 outside
      rows.push({ asOfDate: `2024-0${(i % 9) + 1}-0${(i % 8) + 1}`, marketPrice: price, pvre: fakePvre(80, 100, 120) });
    }
    // make sure exactly 8 are within CI
    const inside = rows.filter((r) => r.marketPrice >= 80 && r.marketPrice <= 120).length;
    expect(inside).toBe(8);
    const score = scorePvreCalibration(rows);
    expect(score.label).toBe("well-calibrated");
    expect(score.coverage80).toBeCloseTo(0.8, 2);
  });

  it("labels overconfident when CI too narrow", () => {
    const rows = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push({
        asOfDate: `2024-01-1${i}`,
        marketPrice: i < 4 ? 100 : 400, // 4 in, 4 far out
        pvre: fakePvre(95, 100, 105),
      });
    }
    const score = scorePvreCalibration(rows);
    expect(score.label).toBe("overconfident");
    expect(score.coverage80).toBe(0.5);
  });

  it("labels underconfident when CI too wide", () => {
    const rows = [];
    for (let i = 0; i < 6; i += 1) {
      rows.push({
        asOfDate: `2024-01-1${i}`,
        marketPrice: 100 + (i - 3) * 0.05, // all within a tiny window
        pvre: fakePvre(0, 100, 200),
      });
    }
    const score = scorePvreCalibration(rows);
    expect(score.label).toBe("underconfident");
    expect(score.coverage80).toBe(1);
  });

  it("computes pinball loss > 0 for a miscalibrated CI", () => {
    const score = scorePvreCalibration([
      { asOfDate: "2024-01-01", marketPrice: 300, pvre: fakePvre(80, 100, 120) },
      { asOfDate: "2024-01-02", marketPrice: 100, pvre: fakePvre(80, 100, 120) },
      { asOfDate: "2024-01-03", marketPrice: 100, pvre: fakePvre(80, 100, 120) },
      { asOfDate: "2024-01-04", marketPrice: 100, pvre: fakePvre(80, 100, 120) },
    ]);
    expect(score.meanPinballLoss80).not.toBeNull();
    expect(score.meanPinballLoss80!).toBeGreaterThan(0);
  });
});

describe("PVRE snapshot persistence", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "pvre-test-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("buildSnapshot produces a valid v1 record", () => {
    const out = fakePvre(80, 100, 120);
    const s = buildSnapshot(out, { ticker: "ITC", asOf: "2026-08-29" });
    expect(s.schemaVersion).toBe("2026-08-pvre-snapshot-v1");
    expect(s.takenAt).toBe("2026-08-29");
    expect(s.ticker).toBe("ITC");
    expect(s.intrinsic?.q50).toBe(100);
  });

  it("snapshotFilename is deterministic", () => {
    const s = buildSnapshot(fakePvre(80, 100, 120), { ticker: "ITC", asOf: "2026-08-29" });
    expect(snapshotFilename(s)).toBe("2026-08-29.seed-1.itr-100.json");
  });

  it("persist + load roundtrip preserves the snapshot", () => {
    const out = fakePvre(80, 100, 120);
    const s1 = buildSnapshot(out, { ticker: "ITC", asOf: "2026-08-28" });
    const s2 = buildSnapshot(out, { ticker: "ITC", asOf: "2026-08-29" });
    persistSnapshot(workspace, s1);
    persistSnapshot(workspace, s2);
    const loaded = loadSnapshots(workspace, "ITC");
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.takenAt).toBe("2026-08-28");
    expect(loaded[1]!.takenAt).toBe("2026-08-29");
    expect(loaded[0]!.intrinsic?.q50).toBe(100);
    // latest.json should mirror the latest snapshot
    const latest = JSON.parse(readFileSync(join(workspace, ".penman", "pvre", "itc", "latest.json"), "utf-8"));
    expect(latest.takenAt).toBe("2026-08-29");
  });

  it("loadSnapshots returns [] for missing ticker directory", () => {
    expect(loadSnapshots(workspace, "NOEXIST")).toEqual([]);
  });

  it("ignores corrupt snapshot files", async () => {
    const out = fakePvre(80, 100, 120);
    persistSnapshot(workspace, buildSnapshot(out, { ticker: "ITC", asOf: "2026-08-29" }));
    // write a corrupt snapshot file
    const dir = join(workspace, ".penman", "pvre", "itc");
    expect(existsSync(dir)).toBe(true);
    const corrupt = join(dir, "2026-08-30.seed-9.itr-5.json");
    const { writeFileSync } = await import("fs");
    writeFileSync(corrupt, "{not valid json");
    const loaded = loadSnapshots(workspace, "ITC");
    // the good one survives; the corrupt one is skipped
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.takenAt).toBe("2026-08-29");
  });
});
