/* ================================================================
   Plan 9 PR-9.3 — Backup scheduler contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  POLICIES,
  shouldSnapshotNow,
  retentionWindow,
  snapshotKey,
  withinRetention,
} from "../backupScheduler";

const NOW = new Date("2026-05-28T12:00:00Z");

describe("POLICIES (Plan 9 PR-9.3)", () => {
  it("Locked evidence is retained forever", () => {
    const locked = POLICIES.find((p) => p.scope === "locked-evidence");
    expect(locked?.retentionDays).toBe("forever");
  });

  it("Event log retains 7 years for compliance", () => {
    const log = POLICIES.find((p) => p.scope === "event-log");
    expect(log?.retentionDays).toBe(7 * 365);
  });

  it("Audit runs retain 90 days, daily snapshots", () => {
    const runs = POLICIES.find((p) => p.scope === "audit-runs");
    expect(runs?.retentionDays).toBe(90);
    expect(runs?.frequency).toBe("daily");
  });

  it("Every scope has a policy", () => {
    const scopes = POLICIES.map((p) => p.scope);
    expect(scopes).toEqual(
      expect.arrayContaining([
        "audit-runs",
        "comparison-registries",
        "residuals",
        "annotations",
        "locked-evidence",
        "event-log",
      ]),
    );
  });
});

describe("shouldSnapshotNow (Plan 9 PR-9.3)", () => {
  it("Genesis (no prior backup) always snapshots", () => {
    expect(shouldSnapshotNow(null, NOW, "hourly")).toBe(true);
    expect(shouldSnapshotNow(null, NOW, "daily")).toBe(true);
  });

  it("Daily: snapshot when 24h+ elapsed", () => {
    const last = new Date("2026-05-27T11:59:59Z"); // 24h+1s ago
    expect(shouldSnapshotNow(last, NOW, "daily")).toBe(true);
  });

  it("Daily: skip when only 23h elapsed", () => {
    const last = new Date("2026-05-27T13:00:00Z");
    expect(shouldSnapshotNow(last, NOW, "daily")).toBe(false);
  });

  it("Hourly: snapshot when 60min+ elapsed", () => {
    const last = new Date("2026-05-28T10:59:00Z");
    expect(shouldSnapshotNow(last, NOW, "hourly")).toBe(true);
  });

  it("Hourly: skip when only 30min elapsed", () => {
    const last = new Date("2026-05-28T11:30:00Z");
    expect(shouldSnapshotNow(last, NOW, "hourly")).toBe(false);
  });
});

describe("retentionWindow (Plan 9 PR-9.3)", () => {
  it("retainForever is true for 'forever'", () => {
    const w = retentionWindow(NOW, "forever");
    expect(w.retainForever).toBe(true);
  });

  it("90-day cutoff is exactly 90 days before now", () => {
    const w = retentionWindow(NOW, 90);
    const expected = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(w.cutoff.getTime()).toBe(expected.getTime());
  });
});

describe("snapshotKey (Plan 9 PR-9.3)", () => {
  it("Lexicographic order matches chronological order", () => {
    const k1 = snapshotKey(new Date("2026-05-28T10:00:00Z"), "audit-runs");
    const k2 = snapshotKey(new Date("2026-05-28T11:00:00Z"), "audit-runs");
    const k3 = snapshotKey(new Date("2026-05-29T00:00:00Z"), "audit-runs");
    expect([k3, k1, k2].sort()).toEqual([k1, k2, k3]);
  });

  it("Includes scope in path", () => {
    const k = snapshotKey(NOW, "event-log");
    expect(k).toMatch(/^snapshots\/event-log\//);
    expect(k).toMatch(/\.json$/);
  });
});

describe("withinRetention (Plan 9 PR-9.3)", () => {
  it("All keys retained when retention is 'forever'", () => {
    const keys = [
      "snapshots/locked-evidence/1990-01-01T00-00-00-000Z.json",
      "snapshots/locked-evidence/2026-05-28T12-00-00-000Z.json",
    ];
    const policy = POLICIES.find((p) => p.scope === "locked-evidence")!;
    expect(withinRetention(keys, policy, NOW)).toEqual(keys);
  });

  it("Keys older than 90 days are dropped", () => {
    const keys = [
      "snapshots/audit-runs/2026-01-01T00-00-00-000Z.json", // > 90 days old
      "snapshots/audit-runs/2026-05-01T00-00-00-000Z.json", // ~28 days old
      "snapshots/audit-runs/2026-05-28T11-00-00-000Z.json", // ~1h old
    ];
    const policy = POLICIES.find((p) => p.scope === "audit-runs")!;
    const kept = withinRetention(keys, policy, NOW);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatch(/2026-05-01/);
    expect(kept[1]).toMatch(/2026-05-28/);
  });

  it("Unparsable keys are kept (defensive)", () => {
    const keys = ["snapshots/audit-runs/legacy.json"];
    const policy = POLICIES.find((p) => p.scope === "audit-runs")!;
    expect(withinRetention(keys, policy, NOW)).toEqual(keys);
  });
});
