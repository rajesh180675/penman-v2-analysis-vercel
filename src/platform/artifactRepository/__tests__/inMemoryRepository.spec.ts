import { describe, expect, it } from "vitest";
import { createLocalWorkspaceAccessContext } from "../../workspaceScope";
import { createInMemoryArtifactRepository } from "..";

const metadata = {
  kind: "evidence" as const,
  schemaVersion: "fixture-v1",
  mediaType: "application/octet-stream",
  contentClass: "test-evidence",
  createdAt: "2026-07-11T10:00:00.000Z",
  issuerId: "issuer-1",
  retentionUntil: "2026-08-01T00:00:00.000Z",
};

describe("in-memory content-addressed artifact repository", () => {
  it("deduplicates immutable bytes and isolates workspace reads", async () => {
    const repository = createInMemoryArtifactRepository();
    const workspaceA = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const workspaceB = createLocalWorkspaceAccessContext("analyst-1", "workspace-b");
    const source = new Uint8Array([1, 2, 3, 4]);
    const first = await repository.put(workspaceA, source, metadata);
    source[0] = 99;
    const replay = await repository.put(workspaceA, new Uint8Array([1, 2, 3, 4]), metadata);

    expect(replay).toEqual(first);
    expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await repository.get(workspaceB.scope, first)).toBeNull();
    const payload = await repository.get(workspaceA.scope, first);
    expect([...payload!.bytes]).toEqual([1, 2, 3, 4]);
    payload!.bytes[0] = 88;
    expect([...(await repository.get(workspaceA.scope, first))!.bytes]).toEqual([1, 2, 3, 4]);
  });

  it("rejects mismatched references and purges only explicit expired content", async () => {
    const repository = createInMemoryArtifactRepository();
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const ref = await repository.put(context, new Uint8Array([5, 6, 7]), metadata);
    expect(await repository.get(context.scope, { ...ref, byteLength: ref.byteLength + 1 })).toBeNull();
    expect(await repository.purgeExpired(context, "2026-07-31T23:59:59.000Z")).toEqual([]);
    expect(await repository.purgeExpired(context, "2026-08-01T00:00:00.000Z")).toEqual([ref]);
    expect(await repository.get(context.scope, ref)).toBeNull();
  });

  it("keeps locked-run evidence under a permanent retention hold", async () => {
    const repository = createInMemoryArtifactRepository();
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const ref = await repository.put(context, new Uint8Array([8, 9]), metadata);
    await repository.applyRetentionHold(context, [ref], "run-lock:lock-1");
    expect(await repository.purgeExpired(context, "2027-01-01T00:00:00.000Z")).toEqual([]);
    expect(await repository.get(context.scope, ref)).not.toBeNull();
  });
});
