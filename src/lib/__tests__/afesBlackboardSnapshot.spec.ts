import { describe, expect, it } from "vitest";
import {
  AFES_BLACKBOARD_SCHEMA_VERSION,
  buildAfesBlackboardSnapshot,
  readAfesBlackboardSnapshot,
} from "../afesBlackboardSnapshot";

describe("afesBlackboardSnapshot", () => {
  it("builds a default snapshot", () => {
    const snapshot = buildAfesBlackboardSnapshot("2026-04-08");

    expect(snapshot).toEqual({
      schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
      session: "2026-04-08",
      round: 1,
      agents_completed: 0,
      agents_pending: 0,
      consensus_score: 0,
      last_updated: null,
      environment: {},
      findings: {},
      debate_log: [],
      code_state: {
        typescript_check: null,
        test_suite: null,
        deployment_status: null,
        last_commit: null,
      },
    });
  });

  it("reads a valid snapshot and preserves known fields", () => {
    const snapshot = readAfesBlackboardSnapshot({
      schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
      session: "2026-04-08",
      round: 2,
      agents_completed: 3,
      agents_pending: 2,
      consensus_score: 0.8,
      last_updated: "2026-04-08T12:00:00.000Z",
      environment: { deployment: "vercel", stack: "react" },
      findings: { audit: { status: "completed" } },
      debate_log: [{ round: 1, summary: "ok" }],
      code_state: {
        typescript_check: "passed",
        test_suite: "215/215",
        deployment_status: "unknown",
        last_commit: "abc123",
      },
    }, "fallback-session");

    expect(snapshot.session).toBe("2026-04-08");
    expect(snapshot.round).toBe(2);
    expect(snapshot.findings.audit?.status).toBe("completed");
    expect(snapshot.debate_log).toHaveLength(1);
    expect(snapshot.code_state.last_commit).toBe("abc123");
  });

  it("fails closed on malformed payloads and wrong schema versions", () => {
    expect(readAfesBlackboardSnapshot("bad", "session-x")).toEqual(buildAfesBlackboardSnapshot("session-x"));
    expect(readAfesBlackboardSnapshot({ schemaVersion: "old", session: "wrong" }, "session-y")).toEqual(buildAfesBlackboardSnapshot("session-y"));
  });

  it("drops malformed nested structures while preserving the session", () => {
    const snapshot = readAfesBlackboardSnapshot({
      schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
      session: "session-z",
      findings: [1, 2, 3],
      debate_log: ["bad", { ok: true }],
      environment: "bad",
      code_state: null,
    }, "fallback");

    expect(snapshot.session).toBe("session-z");
    expect(snapshot.findings).toEqual({});
    expect(snapshot.debate_log).toEqual([{ ok: true }]);
    expect(snapshot.environment).toEqual({});
    expect(snapshot.code_state.last_commit).toBeNull();
  });
});
