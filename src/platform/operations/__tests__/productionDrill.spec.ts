import { describe, expect, it } from "vitest";
import type { DurableObjectStore, TransactionalSqlDriver } from "../../durablePersistence";
import { HmacSha256BackupAuthenticator } from "../backupRestore";
import { ProductionBackupRestoreDrill } from "../productionDrill";

describe("production backup and restore drill", () => {
  it("backs up metadata and objects, verifies an isolated round trip, and cleans staging", async () => {
    const objects = new Map<string, Uint8Array>([["platform/org/workspace/artifact", new Uint8Array([1, 2, 3])]]);
    const objectStore: DurableObjectStore = {
      putIfAbsent: async (key, bytes) => { if (objects.has(key)) return "exists"; objects.set(key, new Uint8Array(bytes)); return "created"; },
      get: async (key) => objects.get(key) ? new Uint8Array(objects.get(key)!) : null,
      delete: async (key) => { objects.delete(key); }, copy: async () => undefined,
    };
    let backupRow: Record<string, unknown> | null = null;
    const sql = {
      dialect: "postgres-compatible", transaction: async (operation: (transaction: TransactionalSqlDriver) => Promise<unknown>) => operation(sql as unknown as TransactionalSqlDriver),
      query: async (text: string, parameters?: readonly unknown[]) => {
        if (text.includes("select object_key, media_type")) return { rows: [{ object_key: "platform/org/workspace/artifact", media_type: "application/octet-stream" }], rowCount: 1 };
        if (text.includes("insert into platform_backup_manifests")) { backupRow = { backup_id: parameters![2], created_at: parameters![3], object_key: parameters![6] }; return { rows: [], rowCount: 1 }; }
        if (text.includes("from platform_backup_manifests")) return { rows: backupRow ? [backupRow] : [], rowCount: backupRow ? 1 : 0 };
        if (text.includes("select count(*) as count")) return { rows: [{ count: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    } as unknown as TransactionalSqlDriver;
    const runner = new ProductionBackupRestoreDrill(sql, objectStore, new HmacSha256BackupAuthenticator("key-1", new Uint8Array(32).fill(5)));
    await runner.createWorkspaceBackup({ organizationId: "org", workspaceId: "workspace", backupId: "backup-1", createdAt: "2026-07-13T00:00:00.000Z" });
    await expect(runner.runLatestRestoreDrill({ organizationId: "org", workspaceId: "workspace", drillId: "drill-1", restoredAt: "2026-07-13T01:00:00.000Z" })).resolves.toMatchObject({ status: "restored" });
    expect([...objects.keys()].some((key) => key.startsWith("platform-restore-drills/"))).toBe(false);
  });
});
