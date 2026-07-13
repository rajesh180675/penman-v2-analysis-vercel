/* ================================================================
   Plan 6 PR-6.4 — Migration runner contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { migrateEnvelope, listMigrationsApplied, KNOWN_SCHEMA_VERSIONS, CURRENT_SCHEMA_VERSION } from "../envelopeMigrations";

const CURRENT = CURRENT_SCHEMA_VERSION;

describe("migrateEnvelope (Plan 6 PR-6.4)", () => {
  it("KNOWN_SCHEMA_VERSIONS includes v8 through the current version", () => {
    expect(KNOWN_SCHEMA_VERSIONS).toContain("2026-04-traceability-v8");
    expect(KNOWN_SCHEMA_VERSIONS).toContain(CURRENT);
  });

  it("Already-current envelope is returned unchanged with no migrations applied", () => {
    const input = { schemaVersion: CURRENT, foo: "bar" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT);
    expect(r.migrationsApplied).toHaveLength(0);
    expect(r.envelope).toEqual(input);
  });

  it("Old v8 envelope is upgraded to current and stamped 'synthetic-clean'", () => {
    const input = { schemaVersion: "2026-04-traceability-v8", legacyField: "x" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT);
    expect(r.envelope.status).toBe("synthetic-clean");
    expect(r.migrationsApplied.length).toBeGreaterThan(0);
    expect(r.migrationsApplied[0]).toBe("2026-04-traceability-v8");
  });

  it("Unknown schemaVersion returns the original with rejection note", () => {
    const input = { schemaVersion: "alien-schema-v99", foo: "bar" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe("alien-schema-v99");
    expect(r.migrationsApplied).toHaveLength(0);
    expect(r.rejected).toBe(true);
  });

  it("Missing schemaVersion returns rejected", () => {
    const input = { foo: "bar" } as any;
    const r = migrateEnvelope(input);
    expect(r.rejected).toBe(true);
  });

  it("Each step records intermediate versions in migrationsApplied", () => {
    const input = { schemaVersion: "2026-06-traceability-v12", x: 1 };
    const r = migrateEnvelope(input);
    expect(r.migrationsApplied).toContain("2026-06-traceability-v12");
    expect(r.migrationsApplied).toContain("2026-06-traceability-v13");
    expect(r.envelope.schemaVersion).toBe(CURRENT);
  });

  it("listMigrationsApplied returns the applied migration count for a journey", () => {
    expect(listMigrationsApplied("2026-04-traceability-v8")).toBeGreaterThan(0);
    expect(listMigrationsApplied(CURRENT)).toBe(0);
    expect(listMigrationsApplied("not-a-real-version")).toBe(0);
  });

  it("Migration is idempotent — running twice yields the same final envelope", () => {
    const input = { schemaVersion: "2026-04-traceability-v8" };
    const r1 = migrateEnvelope(input);
    const r2 = migrateEnvelope(r1.envelope);
    expect(r1.envelope.schemaVersion).toBe(CURRENT);
    expect(r2.envelope.schemaVersion).toBe(CURRENT);
    expect(r2.migrationsApplied).toHaveLength(0);
  });

  it("v17 → current adds analyticalDepth defaulting to null (legacy envelopes had no depth)", () => {
    const input = { schemaVersion: "2026-06-traceability-v17", locked: true, foo: "bar" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT);
    expect(r.envelope.analyticalDepth).toBeNull();
    expect(r.envelope.antiTautology).toBeNull();
    expect(r.migrationsApplied).toContain("2026-06-traceability-v17");
    // Non-destructive: prior fields carried forward.
    expect(r.envelope.locked).toBe(true);
    expect(r.envelope.foo).toBe("bar");
  });

  it("v17 → v18 preserves an already-present analyticalDepth block (does not clobber)", () => {
    const depth = { status: "rich", summary: "4/4", presentCount: 4, watchCount: 0, checks: [] };
    const input = { schemaVersion: "2026-06-traceability-v17", analyticalDepth: depth };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT);
    expect(r.envelope.analyticalDepth).toEqual(depth);
  });

  it("v18 → v19 adds antiTautology defaulting to null", () => {
    const input = { schemaVersion: "2026-06-traceability-v18", analyticalDepth: null, foo: "bar" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.envelope.antiTautology).toBeNull();
    expect(r.envelope.sourceArtifactHashes).toBeNull();
    expect(r.migrationsApplied).toContain("2026-06-traceability-v18");
    expect(r.migrationsApplied).toContain("2026-06-traceability-v19");
    expect(r.envelope.foo).toBe("bar");
  });

  it("v19 → v20 adds sourceArtifactHashes defaulting to null", () => {
    const input = { schemaVersion: "2026-06-traceability-v19", antiTautology: null, foo: "baz" };
    const r = migrateEnvelope(input);
    expect(r.envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.envelope.sourceArtifactHashes).toBeNull();
    expect(r.migrationsApplied).toContain("2026-06-traceability-v19");
    expect(r.envelope.foo).toBe("baz");
  });
});
