/* ================================================================
   Plan 8 PR-8.3 — Evidence locking + reproducibility hash tests.
================================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  canonicalize,
  reproducibilityHash,
  lockEvidence,
  verifyLockedHash,
  isReadOnly,
} from "../evidenceLocking";
import { TRACEABILITY_SCHEMA_VERSION } from "../../engine/policyVersions";

vi.useFakeTimers();
beforeEach(() => {
  vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
});

describe("canonicalize (Plan 8 PR-8.3)", () => {
  it("Sorts object keys recursively", () => {
    const a = canonicalize({ b: 1, a: { z: 1, y: 2 } });
    const b = canonicalize({ a: { y: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("Rounds floating point to 12 decimals (no drift)", () => {
    const a = canonicalize({ ke: 0.1 + 0.2 }); // 0.30000000000000004
    const b = canonicalize({ ke: 0.3 });
    expect(a).toBe(b);
  });

  it("Skips undefined, preserves null", () => {
    const out = canonicalize({ a: 1, b: undefined, c: null });
    expect(out).toBe('{"a":1,"c":null}');
  });

  it("No whitespace in output", () => {
    const out = canonicalize({ a: 1, b: 2 });
    expect(out).not.toMatch(/\s/);
  });
});

describe("reproducibilityHash (Plan 8 PR-8.3)", () => {
  it("Same envelope -> same hash", async () => {
    const env = { a: 1, b: 2 };
    expect(await reproducibilityHash(env)).toBe(await reproducibilityHash(env));
  });

  it("Different envelopes -> different hashes", async () => {
    const a = await reproducibilityHash({ a: 1 });
    const b = await reproducibilityHash({ a: 2 });
    expect(a).not.toBe(b);
  });

  it("Key order doesn't change the hash", async () => {
    const a = await reproducibilityHash({ a: 1, b: 2, c: 3 });
    const b = await reproducibilityHash({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("Hash is 64 hex chars (SHA-256)", async () => {
    const h = await reproducibilityHash({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("lockEvidence + verifyLockedHash (Plan 8 PR-8.3)", () => {
  it("lockEvidence stamps current schema, hash, and signature", async () => {
    const env = { runId: "r-001", value: 100 };
    const locked = await lockEvidence(env, { reviewerId: "alice", reviewerName: "Alice" });
    expect(locked.schemaVersion).toBe(TRACEABILITY_SCHEMA_VERSION);
    expect(locked.locked).toBe(true);
    expect(locked.reproducibilityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(locked.lockedBy.reviewerId).toBe("alice");
    expect(locked.lockedAt).toBe("2026-05-28T12:00:00.000Z");
    expect(locked.envelope).toEqual(env);
  });

  it("verifyLockedHash returns true on untampered envelope", async () => {
    const locked = await lockEvidence({ x: 1 }, { reviewerId: "alice" });
    expect(await verifyLockedHash(locked)).toBe(true);
  });

  it("verifyLockedHash returns false when envelope is mutated", async () => {
    const locked = await lockEvidence({ x: 1 }, { reviewerId: "alice" });
    (locked.envelope as Record<string, unknown>)["x"] = 2;
    expect(await verifyLockedHash(locked)).toBe(false);
  });

  it("isReadOnly returns true for locked envelopes", async () => {
    const locked = await lockEvidence({ x: 1 }, { reviewerId: "alice" });
    expect(isReadOnly(locked)).toBe(true);
  });

  it("Same envelope locked twice yields the same hash", async () => {
    const env = { runId: "r-001", value: 100 };
    const a = await lockEvidence(env, { reviewerId: "alice" });
    const b = await lockEvidence(env, { reviewerId: "bob" });
    // Hash is content-only — locker identity doesn't affect it
    expect(a.reproducibilityHash).toBe(b.reproducibilityHash);
  });
});
