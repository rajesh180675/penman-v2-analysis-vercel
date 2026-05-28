/* ================================================================
   Plan 4 PR-4.2 — auditRunStore contract tests.
================================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveAuditRun,
  loadAuditRun,
  listAuditRuns,
  deleteAuditRun,
  type AuditRunRecord,
} from "../auditRunStore";
import { setAuthId } from "../identity";

function makeRecord(overrides: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    runId: "run-1",
    companyId: "TEST",
    generatedAt: "2026-01-15T10:00:00Z",
    envelopeSchemaVersion: "2026-06-traceability-v17",
    summary: {
      rigorLevel: "production-ready",
      valuationStatus: "ready",
      blockingCount: 0,
      diagnosticCount: 2,
    },
    envelope: { schemaVersion: "2026-06-traceability-v17" } as any,
    ...overrides,
  };
}

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof document !== "undefined") {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
  setAuthId(null);
});

describe("auditRunStore (Plan 4 PR-4.2)", () => {
  it("save + load round-trip preserves the record", async () => {
    const rec = makeRecord();
    await saveAuditRun(rec);
    const loaded = await loadAuditRun("run-1");
    expect(loaded).toEqual(rec);
  });

  it("loadAuditRun returns null for missing runId", async () => {
    const loaded = await loadAuditRun("never-existed");
    expect(loaded).toBeNull();
  });

  it("listAuditRuns returns most-recent-first", async () => {
    await saveAuditRun(makeRecord({ runId: "old", generatedAt: "2026-01-01T00:00:00Z" }));
    await saveAuditRun(makeRecord({ runId: "new", generatedAt: "2026-01-15T00:00:00Z" }));
    const runs = await listAuditRuns();
    expect(runs.map((r) => r.runId)).toEqual(["new", "old"]);
  });

  it("deleteAuditRun removes record + index entry", async () => {
    await saveAuditRun(makeRecord({ runId: "to-delete" }));
    expect(await loadAuditRun("to-delete")).not.toBeNull();
    await deleteAuditRun("to-delete");
    expect(await loadAuditRun("to-delete")).toBeNull();
    const runs = await listAuditRuns();
    expect(runs.find((r) => r.runId === "to-delete")).toBeUndefined();
  });

  it("re-saving the same runId updates without duplicating in index", async () => {
    await saveAuditRun(makeRecord({ runId: "stable", generatedAt: "2026-01-01T00:00:00Z" }));
    await saveAuditRun(makeRecord({ runId: "stable", generatedAt: "2026-01-15T00:00:00Z" }));
    const runs = await listAuditRuns();
    const stable = runs.filter((r) => r.runId === "stable");
    expect(stable).toHaveLength(1);
    expect(stable[0]?.generatedAt).toBe("2026-01-15T00:00:00Z");
  });

  it("anonymous and authenticated users see separate run histories", async () => {
    await saveAuditRun(makeRecord({ runId: "anon-run" }));
    expect(await listAuditRuns()).toHaveLength(1);

    setAuthId("user-x");
    expect(await listAuditRuns()).toHaveLength(0);
    await saveAuditRun(makeRecord({ runId: "auth-run" }));
    expect(await listAuditRuns()).toHaveLength(1);
    expect((await listAuditRuns())[0]?.runId).toBe("auth-run");

    setAuthId(null);
    const anonRuns = await listAuditRuns();
    expect(anonRuns).toHaveLength(1);
    expect(anonRuns[0]?.runId).toBe("anon-run");
  });
});
