import { describe, expect, it } from "vitest";
import type { WorkspaceAccessContext } from "../../workspaceScope";
import { DistributedRateLimiter, InMemoryAtomicRateLimitStore } from "../distributedRateLimit";
import { InMemoryWorkspaceMembershipStore, authorizeWorkspacePermission } from "../rbac";

const context: WorkspaceAccessContext = {
  principal: { kind: "server-session", principalId: "principal-1", organizationId: "org-1", userId: "user-1" },
  scope: { organizationId: "org-1", workspaceId: "workspace-1" },
};

describe("workspace production security boundary", () => {
  it("grants only role-derived permissions in the exact workspace", async () => {
    const memberships = new InMemoryWorkspaceMembershipStore([{
      principalId: "principal-1", organizationId: "org-1", workspaceId: "workspace-1",
      roles: ["analyst"], status: "active", validFrom: "2026-01-01T00:00:00.000Z", validUntil: null,
    }]);
    await expect(authorizeWorkspacePermission({ context, permission: "run:create", memberships, asOf: "2026-07-12T00:00:00.000Z" })).resolves.toMatchObject({ roles: ["analyst"] });
    await expect(authorizeWorkspacePermission({ context, permission: "publication:lock", memberships, asOf: "2026-07-12T00:00:00.000Z" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(authorizeWorkspacePermission({ context: { ...context, scope: { organizationId: "org-1", workspaceId: "workspace-2" } }, permission: "run:read", memberships, asOf: "2026-07-12T00:00:00.000Z" })).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
  });

  it("uses an atomic workspace/principal/action rate-limit key", async () => {
    const limiter = new DistributedRateLimiter(new InMemoryAtomicRateLimitStore());
    const request = { organizationId: "org-1", workspaceId: "workspace-1", principalId: "principal-1", action: "run:create", limit: 2, windowSeconds: 60, now: new Date("2026-07-12T00:00:00.000Z") };
    expect((await limiter.acquire(request)).allowed).toBe(true);
    expect((await limiter.acquire(request)).remaining).toBe(0);
    const denied = await limiter.acquire(request);
    expect(denied).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });
});
