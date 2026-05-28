/* ================================================================
   Plan 8 PR-8.1 — Cell-level annotation contract tests.
================================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cellPathOf,
  appendComment,
  resolveThread,
  serializeThread,
  parseThread,
  type AnnotationThread,
} from "../cellAnnotations";

vi.useFakeTimers();
vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));

beforeEach(() => {
  vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
});

describe("cellPathOf (Plan 8 PR-8.1)", () => {
  it("composes a stable string identity for (runId, surface, cellKey)", () => {
    const a = cellPathOf("run-001", "valuation", "intrinsicValue");
    const b = cellPathOf("run-001", "valuation", "intrinsicValue");
    expect(a).toBe(b);
  });

  it("differs for different runs", () => {
    expect(cellPathOf("run-001", "valuation", "ke")).not.toBe(cellPathOf("run-002", "valuation", "ke"));
  });

  it("differs for different cells in the same run", () => {
    expect(cellPathOf("run-001", "valuation", "ke")).not.toBe(cellPathOf("run-001", "valuation", "kd"));
  });
});

describe("annotation threads (Plan 8 PR-8.1)", () => {
  it("appendComment creates a new thread when none exists", () => {
    const thread: AnnotationThread = {
      cellPath: cellPathOf("run-001", "valuation", "ke"),
      comments: [],
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    const updated = appendComment(thread, {
      authorId: "user-alice",
      body: "Why is ke so high?",
    });

    expect(updated.comments).toHaveLength(1);
    expect(updated.comments[0]?.body).toBe("Why is ke so high?");
    expect(updated.comments[0]?.authorId).toBe("user-alice");
    expect(updated.comments[0]?.createdAt).toBe("2026-05-28T12:00:00.000Z");
  });

  it("appendComment preserves existing comments and adds in order", () => {
    let thread: AnnotationThread = {
      cellPath: "run/x",
      comments: [],
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    thread = appendComment(thread, { authorId: "alice", body: "first" });
    vi.setSystemTime(new Date("2026-05-28T13:00:00Z"));
    thread = appendComment(thread, { authorId: "bob", body: "second" });

    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[0]?.body).toBe("first");
    expect(thread.comments[1]?.body).toBe("second");
  });

  it("resolveThread sets resolved=true and stamps resolution metadata", () => {
    let thread: AnnotationThread = {
      cellPath: "run/x",
      comments: [],
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    thread = appendComment(thread, { authorId: "alice", body: "Q?" });
    thread = resolveThread(thread, { resolverId: "bob", resolution: "Confirmed by source" });

    expect(thread.resolved).toBe(true);
    expect(thread.resolverId).toBe("bob");
    expect(thread.resolution).toBe("Confirmed by source");
    expect(thread.resolvedAt).toBe("2026-05-28T12:00:00.000Z");
  });

  it("appending to a resolved thread re-opens it", () => {
    let thread: AnnotationThread = {
      cellPath: "run/x",
      comments: [],
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    thread = appendComment(thread, { authorId: "alice", body: "Q?" });
    thread = resolveThread(thread, { resolverId: "bob", resolution: "ok" });
    expect(thread.resolved).toBe(true);

    thread = appendComment(thread, { authorId: "carol", body: "Wait, but..." });
    expect(thread.resolved).toBe(false);
    expect(thread.comments).toHaveLength(2);
  });

  it("serialize / parse round-trip preserves the thread", () => {
    const thread: AnnotationThread = {
      cellPath: "run/x",
      comments: [
        { id: "c1", authorId: "alice", body: "Q?", createdAt: "2026-05-28T12:00:00.000Z" },
        { id: "c2", authorId: "bob", body: "answer", createdAt: "2026-05-28T13:00:00.000Z" },
      ],
      resolved: true,
      resolverId: "bob",
      resolution: "ok",
      resolvedAt: "2026-05-28T13:01:00.000Z",
      createdAt: "2026-05-28T12:00:00.000Z",
    };

    const wire = serializeThread(thread);
    const parsed = parseThread(wire);
    expect(parsed).toEqual(thread);
  });

  it("parseThread returns null for malformed input", () => {
    expect(parseThread("not json")).toBeNull();
    expect(parseThread('{"missing":"fields"}')).toBeNull();
  });
});
