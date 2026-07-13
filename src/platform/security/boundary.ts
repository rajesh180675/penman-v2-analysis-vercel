import type { WorkspaceAccessContext } from "../workspaceScope";
import { DistributedRateLimiter } from "./distributedRateLimit";
import { authorizeWorkspacePermission, type WorkspaceMembershipStore, type WorkspacePermission } from "./rbac";

export interface PlatformSecurityBoundary {
  authorize(context: WorkspaceAccessContext, permission: WorkspacePermission): Promise<void>;
}

/** Explicit local-mode bypass. Production factories must never construct it. */
export class LocalOnlyPlatformSecurityBoundary implements PlatformSecurityBoundary {
  async authorize(context: WorkspaceAccessContext, _permission: WorkspacePermission): Promise<void> {
    if (context.principal.kind !== "local" || context.scope.organizationId !== "local") {
      throw new Error("Local-only security boundary rejected a non-local principal.");
    }
  }
}

export class WorkspacePlatformSecurityBoundary implements PlatformSecurityBoundary {
  constructor(
    private readonly memberships: WorkspaceMembershipStore,
    private readonly limiter: DistributedRateLimiter,
    private readonly policy: { readonly limitByPermission?: Partial<Record<WorkspacePermission, number>>; readonly windowSeconds: number },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authorize(context: WorkspaceAccessContext, permission: WorkspacePermission): Promise<void> {
    const asOf = this.now();
    await authorizeWorkspacePermission({ context, permission, memberships: this.memberships, asOf: asOf.toISOString() });
    const lease = await this.limiter.acquire({
      organizationId: context.scope.organizationId,
      workspaceId: context.scope.workspaceId,
      principalId: context.principal.principalId,
      action: permission,
      limit: this.policy.limitByPermission?.[permission] ?? 300,
      windowSeconds: this.policy.windowSeconds,
      now: asOf,
    });
    if (!lease.allowed) {
      const error = new Error(`Rate limit exceeded for '${permission}'. Retry after ${lease.retryAfterSeconds} seconds.`);
      error.name = "PlatformRateLimitError";
      throw error;
    }
  }
}
