/* ================================================================
   Plan 9 PR-9.2 — Immutable event log contract tests.
================================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { appendEntry, verifyChain, GENESIS_HASH, type LogEntry } from "../eventLog";

vi.useFakeTimers();
beforeEach(() => {
  vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
});

describe("appendEntry (Plan 9 PR-9.2)", () => {
  it("Genesis entry has prevHash = GENESIS_HASH", async () => {
    const log = await appendEntry([], {
      actorId: "alice",
      kind: "evidence-locked",
      payload: { runId: "r-001" },
    });
    expect(log).toHaveLength(1);
    expect(log[0]?.prevHash).toBe(GENESIS_HASH);
    expect(log[0]?.id).toBe(0);
  });

  it("Second entry's prevHash references the first entry", async () => {
    let log: LogEntry[] = [];
    log = await appendEntry(log, { actorId: "alice", kind: "evidence-locked", payload: { runId: "r-001" } });
    log = await appendEntry(log, { actorId: "bob", kind: "manual-override", payload: { cell: "ke" } });
    expect(log).toHaveLength(2);
    expect(log[1]?.prevHash).not.toBe(GENESIS_HASH);
    expect(log[1]?.prevHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log[1]?.id).toBe(1);
  });

  it("ids are monotonic", async () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      log = await appendEntry(log, { actorId: "alice", kind: "evidence-locked", payload: { i } });
    }
    expect(log.map((e) => e.id)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("verifyChain (Plan 9 PR-9.2)", () => {
  it("Empty log is valid", async () => {
    expect(await verifyChain([])).toEqual({ valid: true, brokenAt: -1 });
  });

  it("Single-entry log is valid when prevHash = GENESIS_HASH", async () => {
    const log = await appendEntry([], { actorId: "alice", kind: "evidence-locked", payload: {} });
    const r = await verifyChain(log);
    expect(r.valid).toBe(true);
  });

  it("Multi-entry untampered log is valid end-to-end", async () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      log = await appendEntry(log, { actorId: "alice", kind: "evidence-locked", payload: { i } });
    }
    const r = await verifyChain(log);
    expect(r.valid).toBe(true);
    expect(r.brokenAt).toBe(-1);
  });

  it("Tampering with payload breaks verification at the next entry", async () => {
    let log: LogEntry[] = [];
    log = await appendEntry(log, { actorId: "alice", kind: "evidence-locked", payload: { v: 1 } });
    log = await appendEntry(log, { actorId: "bob", kind: "manual-override", payload: { v: 2 } });
    log = await appendEntry(log, { actorId: "carol", kind: "run-deleted", payload: { v: 3 } });

    // Tamper with entry 1's payload after the chain was built
    (log[1]!.payload as Record<string, unknown>).v = 999;

    const r = await verifyChain(log);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toMatch(/diverges/);
  });

  it("Tampering with the genesis entry fails verification at index 1", async () => {
    let log: LogEntry[] = [];
    log = await appendEntry(log, { actorId: "alice", kind: "evidence-locked", payload: { v: 1 } });
    log = await appendEntry(log, { actorId: "bob", kind: "manual-override", payload: { v: 2 } });

    log[0]!.actorId = "eve"; // forge actor identity on the genesis entry

    const r = await verifyChain(log);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(1);
  });

  it("Replacing genesis prevHash with non-zero fails at index 0", async () => {
    const log = await appendEntry([], { actorId: "alice", kind: "evidence-locked", payload: {} });
    log[0]!.prevHash = "f".repeat(64);
    const r = await verifyChain(log);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
    expect(r.reason).toMatch(/Genesis/);
  });
});
