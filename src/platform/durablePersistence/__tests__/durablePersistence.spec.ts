import { describe, expect, it, vi } from "vitest";
import { evaluateProductionAdapterReadiness } from "../contracts";
import { PLATFORM_SQL_MIGRATIONS, applyPlatformMigrations } from "../migrations";
import { SqlAtomicRateLimitStore, SqlWorkspaceMembershipStore } from "../sqlSecurityAdapters";

describe("durable platform persistence", () => {
  it("defines indexed workspace, retention, vintage, and backup tables", () => {
    const sql = PLATFORM_SQL_MIGRATIONS.flatMap((migration) => migration.statements).join("\n");
    expect(sql).toContain("platform_analysis_runs");
    expect(sql).toContain("platform_artifact_retention_idx");
    expect(sql).toContain("platform_workspace_memberships");
    expect(sql).toContain("platform_rate_limits");
    expect(sql).toContain("platform_vintage_observations");
    expect(sql).toContain("platform_backup_manifests");
    expect(sql).toContain("platform_artifact_holds");
    expect(sql).toContain("platform_run_events_run_fk");
    expect(sql).toContain("platform_sector_sidecars");
    expect(sql).toContain("platform_model_promotion_dossiers");
    expect(sql).toContain("platform_model_composition_dossiers");
    expect(sql).toContain("platform_model_composition_reviews");
    expect(sql).toContain("platform_outbox");
  });

  it("applies unapplied migrations transactionally and reports missing adapters", async () => {
    const query = vi.fn(async () => undefined);
    const transaction = vi.fn(async (operation) => operation({ query }));
    const applied = await applyPlatformMigrations({ driver: { transaction }, alreadyApplied: new Set([PLATFORM_SQL_MIGRATIONS[0]!.id]) });
    expect(applied).toEqual(PLATFORM_SQL_MIGRATIONS.slice(1).map((migration) => migration.id));
    expect(transaction).toHaveBeenCalledTimes(PLATFORM_SQL_MIGRATIONS.length);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"));
    expect(evaluateProductionAdapterReadiness({}).status).toBe("blocked");
  });

  it("backs memberships and atomic rate limits with workspace-scoped SQL", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ principal_id: "principal-1", organization_id: "org-1", workspace_id: "workspace-1", roles: ["analyst"], status: "active", valid_from: "2026-01-01T00:00:00.000Z", valid_until: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: 2, reset_at_ms: 1_800_000_000_000 }], rowCount: 1 });
    const driver = { dialect: "postgres-compatible" as const, query, transaction: vi.fn() };
    const memberships = new SqlWorkspaceMembershipStore(driver);
    await expect(memberships.getMembership(
      { kind: "server-session", principalId: "principal-1", organizationId: "org-1", userId: "user-1" },
      { organizationId: "org-1", workspaceId: "workspace-1" },
    )).resolves.toMatchObject({ roles: ["analyst"] });
    await expect(new SqlAtomicRateLimitStore(driver).increment("scope:key", 60, 1_700_000_000_000)).resolves.toEqual({ count: 2, resetAtMs: 1_800_000_000_000 });
    expect(query.mock.calls[0]?.[0]).toContain("platform_workspace_memberships");
    expect(query.mock.calls[1]?.[0]).toContain("on conflict (rate_key)");
  });
});
