import { describe, expect, it } from "vitest";
import { createLocalWorkspaceAccessContext } from "../../workspaceScope";
import { createInMemoryRunOperationsRepository } from "..";

describe("run audit and lock protocol", () => {
  it("appends an idempotent per-run hash chain without cross-workspace visibility", async () => {
    const repository = createInMemoryRunOperationsRepository();
    const workspaceA = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const workspaceB = createLocalWorkspaceAccessContext("analyst-1", "workspace-b");
    const firstDraft = {
      eventId: "event-1",
      runId: "run-1",
      runRevision: 1,
      eventType: "run-created" as const,
      occurredAt: "2026-07-11T10:00:00.000Z",
      correlationId: "request-1",
      payloadRef: null,
    };
    const first = await repository.appendEvent(workspaceA, firstDraft, "event-write-1");
    expect(await repository.appendEvent(workspaceA, firstDraft, "event-write-1")).toBe(first);
    const second = await repository.appendEvent(workspaceA, {
      ...firstDraft,
      eventId: "event-2",
      eventType: "run-finalized",
      runRevision: 2,
      occurredAt: "2026-07-11T10:01:00.000Z",
      correlationId: "request-2",
    }, "event-write-2");
    expect(second.sequence).toBe(2);
    expect(second.previousEventHash).toBe(first.eventHash);
    expect(await repository.listEvents(workspaceB.scope, "run-1")).toEqual([]);
    expect((await repository.listEvents(workspaceA.scope, "run-1", { afterSequence: 1 })).map((event) => event.eventId)).toEqual(["event-2"]);
  });

  it("creates a one-way idempotent publication lock", async () => {
    const repository = createInMemoryRunOperationsRepository();
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const input = {
      lockId: "lock-1",
      runId: "run-1",
      runRevision: 2,
      reason: "Reviewer-approved publication.",
      lockedAt: "2026-07-11T10:02:00.000Z",
    };
    const lock = await repository.lockRun(context, input);
    expect(await repository.lockRun(context, input)).toBe(lock);
    await expect(repository.lockRun(context, { ...input, lockId: "lock-2" })).rejects.toMatchObject({
      code: "RUN_ALREADY_LOCKED",
    });
    expect(await repository.getLock(context.scope, "run-1")).toBe(lock);
  });
});
