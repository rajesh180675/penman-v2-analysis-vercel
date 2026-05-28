/* ================================================================
   Plan 6 PR-6.4 — Migration runner contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { migrateEnvelope, listMigrationsApplied, KNOWN_SCHEMA_VERSIONS, CURRENT_SCHEMA_VERSION } from "../envelopeMigrations";

const CURRENT = CURRENT_SCHEMA_VERSION;

describe("migrateEnvelope (Plan 6 PR-6.4)", () => {
  it("KNOWN_SCHEMA_VERSIONS includes v8 through v17", () => {
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
});
