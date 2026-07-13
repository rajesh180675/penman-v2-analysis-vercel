import { describe, expect, it, vi } from "vitest";
import { SqlArtifactRepository } from "../sqlArtifactRepository";
import { SqlOutboxDispatcher } from "../sqlOutbox";
import type { DurableObjectStore, TransactionalSqlDriver } from "../contracts";
import { createLocalWorkspaceAccessContext } from "../../workspaceScope";

function objectStore(): DurableObjectStore & { readonly data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    putIfAbsent: async (key, bytes) => { if (data.has(key)) return "exists"; data.set(key, new Uint8Array(bytes)); return "created"; },
    get: async (key) => data.get(key) ? new Uint8Array(data.get(key)!) : null,
    delete: async (key) => { data.delete(key); }, copy: async (source, destination) => { data.set(destination, new Uint8Array(data.get(source)!)); },
  };
}

describe("production SQL adapters", () => {
  it("stores artifact metadata separately and verifies object bytes on read", async () => {
    let storedRow: Record<string, unknown> | null = null;
    const query = vi.fn(async (text: string, params?: readonly unknown[]) => {
      if (text.includes("insert into platform_artifacts")) {
        storedRow = { content_hash: params![2], kind: params![3], schema_version: params![4], media_type: params![5], byte_length: params![6], object_key: params![7], content_class: params![8], issuer_id: params![9], created_at: params![10], retention_until: params![11] };
        return { rows: [], rowCount: 1 };
      }
      return { rows: storedRow ? [storedRow] : [], rowCount: storedRow ? 1 : 0 };
    });
    const driver = { dialect: "postgres-compatible" as const, query, transaction: vi.fn() } as unknown as TransactionalSqlDriver;
    const objects = objectStore(); const repository = new SqlArtifactRepository(driver, objects);
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-1");
    const ref = await repository.put(context, new Uint8Array([1, 2, 3]), { kind: "evidence", schemaVersion: "v1", mediaType: "application/octet-stream", contentClass: "test", createdAt: "2026-07-13T00:00:00.000Z", issuerId: "issuer-1", retentionUntil: null });
    await expect(repository.get(context.scope, ref)).resolves.toMatchObject({ ref, metadata: { issuerId: "issuer-1" } });
    objects.data.set([...objects.data.keys()][0]!, new Uint8Array([9, 9, 9]));
    await expect(repository.get(context.scope, ref)).resolves.toBeNull();
  });

  it("leases outbox messages and records successful delivery", async () => {
    const row = { organization_id: "org-1", workspace_id: "workspace-1", message_id: "event-1", topic: "analysis-run.run-created", aggregate_id: "run-1", payload_json: { ok: true }, attempt_count: 0 };
    const query = vi.fn(async (text: string) => ({ rows: text.includes("from platform_outbox") ? [row] : [], rowCount: 1 }));
    const driver = { dialect: "postgres-compatible", query, transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({ query }) } as unknown as TransactionalSqlDriver;
    const deliver = vi.fn(async () => undefined);
    await expect(new SqlOutboxDispatcher(driver, { deliver }).dispatchBatch({ workerId: "worker-1", now: "2026-07-13T00:00:00.000Z" })).resolves.toEqual({ delivered: 1, failed: 0 });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ messageId: "event-1" }));
    expect(query.mock.calls.some(([text]) => String(text).includes("delivered_at"))).toBe(true);
  });
});
