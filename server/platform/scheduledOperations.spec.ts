import { describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDriver } from "../../src/platform";
import { cronAuthorizationMatches, listActiveWorkspaceScopes } from "./scheduledOperations";

describe("scheduled platform operations", () => {
  it("compares cron bearer credentials without accepting missing values", () => {
    expect(cronAuthorizationMatches("Bearer secret", "secret")).toBe(true);
    expect(cronAuthorizationMatches("Bearer wrong", "secret")).toBe(false);
    expect(cronAuthorizationMatches(undefined, "secret")).toBe(false);
  });

  it("discovers active workspace scopes with a bounded query", async () => {
    const query = vi.fn(async () => ({ rows: [{ organization_id: "org-1", workspace_id: "ws-1" }], rowCount: 1 }));
    const sql = { dialect: "postgres-compatible" as const, query, transaction: vi.fn() } as unknown as TransactionalSqlDriver;
    await expect(listActiveWorkspaceScopes(sql, 10)).resolves.toEqual([{ organizationId: "org-1", workspaceId: "ws-1" }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"), [10]);
  });
});
