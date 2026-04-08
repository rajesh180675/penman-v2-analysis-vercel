import { afterEach, describe, expect, it, vi } from "vitest";
import { AFES_BLACKBOARD_SCHEMA_VERSION } from "../afesBlackboardSnapshot";
import { fetchAfesBlackboard, postAfesBlackboardOperation } from "../sharedResearchApi";

describe("sharedResearchApi AFES wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches and normalizes AFES blackboard payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
        session: "2026-04-08",
        round: 2,
        findings: { agent1: { status: "done" } },
        debate_log: [],
        code_state: {},
      }),
    }));

    const snapshot = await fetchAfesBlackboard("2026-04-08");

    expect(fetch).toHaveBeenCalledWith("/api/blackboard?session=2026-04-08");
    expect(snapshot?.session).toBe("2026-04-08");
    expect(snapshot?.round).toBe(2);
    expect(snapshot?.findings.agent1?.status).toBe("done");
  });

  it("posts AFES blackboard operations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    await postAfesBlackboardOperation({
      session: "2026-04-08",
      operation: "upsert-finding",
      findingKey: "agent1",
      finding: { status: "done" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/blackboard", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
  });

  it("fails closed on fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(fetchAfesBlackboard("2026-04-08")).resolves.toBeNull();
    await expect(postAfesBlackboardOperation({ session: "2026-04-08", operation: "patch-code-state" })).resolves.toBeNull();
  });
});
