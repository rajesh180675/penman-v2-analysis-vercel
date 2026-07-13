import { WORKSPACE_ROLES, type WorkspaceMembership, type WorkspaceRole } from "./rbac";
import type { PlatformSecurityBoundary } from "./boundary";
import { parsePlatformIdentifier, type WorkspaceAccessContext } from "../workspaceScope";

export interface WorkspaceMembershipAdministrationStore {
  writeMembership(context: WorkspaceAccessContext, membership: WorkspaceMembership, event: { readonly eventId: string; readonly occurredAt: string }): Promise<WorkspaceMembership>;
}

export class WorkspaceMembershipAdministrationService {
  constructor(private readonly store: WorkspaceMembershipAdministrationStore, private readonly security: PlatformSecurityBoundary) {}

  async write(context: WorkspaceAccessContext, input: {
    readonly principalId: string; readonly roles: readonly WorkspaceRole[];
    readonly status: WorkspaceMembership["status"]; readonly validFrom: string; readonly validUntil: string | null;
    readonly eventId: string; readonly occurredAt: string;
  }) {
    await this.security.authorize(context, "workspace:administer");
    const principalId = parsePlatformIdentifier(input.principalId, "membership.principalId");
    if (!input.roles.length || input.roles.some((role) => !WORKSPACE_ROLES.includes(role)) || new Set(input.roles).size !== input.roles.length) throw new Error("Membership roles are invalid.");
    if (!Number.isFinite(Date.parse(input.validFrom)) || (input.validUntil !== null && (!Number.isFinite(Date.parse(input.validUntil)) || Date.parse(input.validUntil) <= Date.parse(input.validFrom)))) throw new Error("Membership validity window is invalid.");
    if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error("Membership event time is invalid.");
    const membership: WorkspaceMembership = { principalId, organizationId: context.scope.organizationId, workspaceId: context.scope.workspaceId, roles: Object.freeze([...input.roles]), status: input.status, validFrom: input.validFrom, validUntil: input.validUntil };
    return this.store.writeMembership(context, membership, { eventId: parsePlatformIdentifier(input.eventId, "membership.eventId"), occurredAt: input.occurredAt });
  }
}
