import type { WorkspaceAccessContext, WorkspacePrincipal, WorkspaceScope } from "../workspaceScope";

export const WORKSPACE_ROLES = ["viewer", "analyst", "reviewer", "publisher", "administrator"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_PERMISSIONS = [
  "run:read",
  "run:create",
  "run:finalize",
  "artifact:read",
  "artifact:write",
  "publication:review",
  "publication:lock",
  "retention:manage",
  "workspace:administer",
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly WorkspacePermission[]>> = {
  viewer: ["run:read", "artifact:read"],
  analyst: ["run:read", "run:create", "artifact:read", "artifact:write"],
  reviewer: ["run:read", "artifact:read", "publication:review"],
  publisher: ["run:read", "run:finalize", "artifact:read", "publication:review", "publication:lock"],
  administrator: [...WORKSPACE_PERMISSIONS],
};

export interface WorkspaceMembership {
  readonly principalId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly roles: readonly WorkspaceRole[];
  readonly status: "active" | "suspended" | "revoked";
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface WorkspaceMembershipStore {
  getMembership(principal: WorkspacePrincipal, scope: WorkspaceScope): Promise<WorkspaceMembership | null>;
}

export class WorkspaceAuthorizationError extends Error {
  constructor(
    readonly code: "MEMBERSHIP_REQUIRED" | "MEMBERSHIP_INACTIVE" | "PERMISSION_DENIED" | "CROSS_ORGANIZATION_SCOPE" | "LOCAL_PRINCIPAL_NOT_AUTHENTICATED",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceAuthorizationError";
  }
}

function timestampActive(membership: WorkspaceMembership, asOf: string): boolean {
  return membership.validFrom <= asOf && (membership.validUntil === null || membership.validUntil > asOf);
}

export async function authorizeWorkspacePermission(input: {
  readonly context: WorkspaceAccessContext;
  readonly permission: WorkspacePermission;
  readonly memberships: WorkspaceMembershipStore;
  readonly asOf: string;
}): Promise<WorkspaceMembership> {
  if (input.context.principal.organizationId !== input.context.scope.organizationId) {
    throw new WorkspaceAuthorizationError("CROSS_ORGANIZATION_SCOPE", "Principal and workspace organizations must match.");
  }
  if (input.context.principal.kind === "local") {
    throw new WorkspaceAuthorizationError("LOCAL_PRINCIPAL_NOT_AUTHENTICATED", "Local principals are not accepted by the production authorization boundary.");
  }
  const membership = await input.memberships.getMembership(input.context.principal, input.context.scope);
  if (!membership) throw new WorkspaceAuthorizationError("MEMBERSHIP_REQUIRED", "An explicit workspace membership is required.");
  if (membership.status !== "active" || !timestampActive(membership, input.asOf)) {
    throw new WorkspaceAuthorizationError("MEMBERSHIP_INACTIVE", "Workspace membership is not active at the operation time.");
  }
  const permissions = new Set(membership.roles.flatMap((role) => ROLE_PERMISSIONS[role]));
  if (!permissions.has(input.permission)) {
    throw new WorkspaceAuthorizationError("PERMISSION_DENIED", `Permission '${input.permission}' is required.`);
  }
  return membership;
}

export class InMemoryWorkspaceMembershipStore implements WorkspaceMembershipStore {
  readonly #memberships = new Map<string, WorkspaceMembership>();

  constructor(memberships: readonly WorkspaceMembership[] = []) {
    for (const membership of memberships) {
      const key = `${membership.organizationId}\u0000${membership.workspaceId}\u0000${membership.principalId}`;
      this.#memberships.set(key, Object.freeze({ ...membership, roles: Object.freeze([...membership.roles]) }));
    }
  }

  async getMembership(principal: WorkspacePrincipal, scope: WorkspaceScope): Promise<WorkspaceMembership | null> {
    if (principal.organizationId !== scope.organizationId) return null;
    return this.#memberships.get(`${scope.organizationId}\u0000${scope.workspaceId}\u0000${principal.principalId}`) ?? null;
  }
}
