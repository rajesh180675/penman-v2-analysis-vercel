import { describe, expect, it, vi } from "vitest";
import { WorkspaceMembershipAdministrationService, type PlatformSecurityBoundary, type WorkspaceMembershipAdministrationStore } from "..";
import type { WorkspaceAccessContext } from "../../workspaceScope";

const context: WorkspaceAccessContext = { principal: { kind: "server-session", principalId: "admin-1", organizationId: "org-1", userId: "admin-1" }, scope: { organizationId: "org-1", workspaceId: "workspace-1" } };

describe("workspace membership administration", () => {
  it("authorizes administration and binds target membership to the current workspace", async () => {
    const writeMembership = vi.fn(async (_context, membership) => membership);
    const authorize = vi.fn(async () => undefined);
    const service = new WorkspaceMembershipAdministrationService({ writeMembership } satisfies WorkspaceMembershipAdministrationStore, { authorize } satisfies PlatformSecurityBoundary);
    await expect(service.write(context, { principalId: "analyst-1", roles: ["analyst"], status: "active", validFrom: "2026-07-13T00:00:00.000Z", validUntil: null, eventId: "membership-1", occurredAt: "2026-07-13T00:00:00.000Z" })).resolves.toMatchObject({ organizationId: "org-1", workspaceId: "workspace-1", principalId: "analyst-1" });
    expect(authorize).toHaveBeenCalledWith(context, "workspace:administer");
  });

  it("rejects duplicate roles and invalid validity windows before persistence", async () => {
    const store = { writeMembership: vi.fn() } as unknown as WorkspaceMembershipAdministrationStore;
    const service = new WorkspaceMembershipAdministrationService(store, { authorize: vi.fn(async () => undefined) });
    await expect(service.write(context, { principalId: "analyst-1", roles: ["analyst", "analyst"], status: "active", validFrom: "2026-07-13T00:00:00.000Z", validUntil: "2026-07-12T00:00:00.000Z", eventId: "membership-1", occurredAt: "2026-07-13T00:00:00.000Z" })).rejects.toThrow();
    expect(store.writeMembership).not.toHaveBeenCalled();
  });
});
