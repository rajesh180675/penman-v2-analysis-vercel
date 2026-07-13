import { describe, expect, it, vi } from "vitest";
import { createBackupPackage, HmacSha256BackupAuthenticator, verifyAndRestoreBackup } from "../backupRestore";
import { evaluatePlatformOperationalHealth } from "../health";
import { InMemoryPlatformTelemetrySink, recordPlatformOperation } from "../telemetry";

describe("production operations", () => {
  it("verifies every byte and manifest hash before restoring", async () => {
    const authenticator = new HmacSha256BackupAuthenticator("backup-key-1", new Uint8Array(32).fill(7));
    const backup = await createBackupPackage({ backupId: "backup-1", organizationId: "org-1", workspaceId: "workspace-1", createdAt: "2026-07-12T00:00:00.000Z", entries: [{ key: "runs/run-1.json", mediaType: "application/json", bytes: new TextEncoder().encode("{\"ok\":true}") }], authenticator });
    const restoreAtomically = vi.fn(async () => undefined);
    await expect(verifyAndRestoreBackup(backup, { restoreAtomically }, authenticator)).resolves.toMatchObject({ status: "restored", restoredCount: 1 });
    expect(restoreAtomically).toHaveBeenCalledOnce();
    const corrupted = { ...backup, entries: [{ ...backup.entries[0]!, bytes: new Uint8Array([9]) }] };
    await expect(verifyAndRestoreBackup(corrupted, { restoreAtomically }, authenticator)).resolves.toMatchObject({ status: "blocked", restoredCount: 0 });
    const appended = { ...backup, entries: [...backup.entries, { key: "unsigned/extra.json", mediaType: "application/json", bytes: new Uint8Array([1]) }] };
    await expect(verifyAndRestoreBackup(appended, { restoreAtomically }, authenticator)).resolves.toMatchObject({ status: "blocked", restoredCount: 0, errors: expect.arrayContaining(["UNMANIFESTED_ENTRY:unsigned/extra.json"]) });
    expect(restoreAtomically).toHaveBeenCalledTimes(1);
  });

  it("emits sanitized operation telemetry and fail-closed health alerts", async () => {
    const sink = new InMemoryPlatformTelemetrySink();
    await recordPlatformOperation({ sink, eventName: "run.create", attributes: { token: "secret", count: 3 }, now: (() => { let value = 0; return () => value += 5; })(), operation: async () => "ok" });
    expect(sink.events[0]?.attributes).toEqual({ token: "[REDACTED]", count: 3 });
    const health = evaluatePlatformOperationalHealth({ checkedAt: "2026-07-12T00:00:00.000Z", adapters: { status: "blocked", checks: [] }, pendingMigrationCount: 1, latestBackupAt: null, maximumBackupAgeHours: 26, restoreDrillAt: null, maximumRestoreDrillAgeDays: 100 });
    expect(health.status).toBe("critical");
    expect(health.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining(["PRODUCTION_ADAPTERS_BLOCKED", "PENDING_SCHEMA_MIGRATIONS", "BACKUP_STALE"]));
    const invalid = evaluatePlatformOperationalHealth({ checkedAt: "not-a-date", adapters: { status: "ready", checks: [] }, pendingMigrationCount: 0, latestBackupAt: "also-invalid", maximumBackupAgeHours: 24, restoreDrillAt: "2099-01-01T00:00:00.000Z", maximumRestoreDrillAgeDays: 100 });
    expect(invalid.status).toBe("critical");
    expect(invalid.alerts.map((alert) => alert.code)).toContain("HEALTH_CLOCK_INVALID");
  });

  it("does not let telemetry failure replace business outcomes", async () => {
    const sink = { emit: vi.fn(async () => { throw new Error("telemetry unavailable"); }) };
    await expect(recordPlatformOperation({ sink, eventName: "test.ok", operation: async () => 42 })).resolves.toBe(42);
    const original = new Error("business failure");
    await expect(recordPlatformOperation({ sink, eventName: "test.error", operation: async () => { throw original; } })).rejects.toBe(original);
  });
});
