import type { AtomicRateLimitStore, WorkspaceMembership, WorkspaceMembershipAdministrationStore, WorkspaceMembershipStore } from "../security";
import type { WorkspaceAccessContext, WorkspacePrincipal, WorkspaceScope } from "../workspaceScope";
import type { TransactionalSqlDriver } from "./contracts";

const VALID_ROLES = new Set(["viewer", "analyst", "reviewer", "publisher", "administrator"]);

function rolesFrom(value: unknown): WorkspaceMembership["roles"] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((role) => typeof role !== "string" || !VALID_ROLES.has(role))) {
    throw new Error("Stored workspace membership roles are invalid.");
  }
  return parsed as WorkspaceMembership["roles"];
}

interface MembershipRow extends Record<string, unknown> {
  principal_id: string; organization_id: string; workspace_id: string; roles: unknown;
  status: WorkspaceMembership["status"]; valid_from: string | Date; valid_until: string | Date | null;
}

function membershipFromRow(row: MembershipRow): WorkspaceMembership {
  return Object.freeze({ principalId: row.principal_id, organizationId: row.organization_id, workspaceId: row.workspace_id, roles: Object.freeze([...rolesFrom(row.roles)]), status: row.status, validFrom: new Date(row.valid_from).toISOString(), validUntil: row.valid_until == null ? null : new Date(row.valid_until).toISOString() });
}

export class SqlWorkspaceMembershipStore implements WorkspaceMembershipStore, WorkspaceMembershipAdministrationStore {
  constructor(private readonly driver: TransactionalSqlDriver) {}

  async getMembership(principal: WorkspacePrincipal, scope: WorkspaceScope): Promise<WorkspaceMembership | null> {
    if (principal.organizationId !== scope.organizationId) return null;
    const result = await this.driver.query<MembershipRow>(`select principal_id, organization_id, workspace_id, roles, status, valid_from, valid_until
       from platform_workspace_memberships
       where organization_id = $1 and workspace_id = $2 and principal_id = $3`, [
      scope.organizationId, scope.workspaceId, principal.principalId,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return membershipFromRow(row);
  }

  async writeMembership(context: WorkspaceAccessContext, membership: WorkspaceMembership, event: { readonly eventId: string; readonly occurredAt: string }): Promise<WorkspaceMembership> {
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<MembershipRow>(
        `select principal_id, organization_id, workspace_id, roles, status, valid_from, valid_until from platform_workspace_memberships
         where organization_id = $1 and workspace_id = $2 and principal_id = $3 for update`,
        [context.scope.organizationId, context.scope.workspaceId, membership.principalId],
      );
      const previous = existing.rows[0] ? membershipFromRow(existing.rows[0]) : null;
      const removesAdministrator = previous?.status === "active" && previous.roles.includes("administrator")
        && (membership.status !== "active" || !membership.roles.includes("administrator"));
      if (removesAdministrator) {
        const administrators = await tx.query<{ count: number | string } & Record<string, unknown>>(
          `select count(*) as count from platform_workspace_memberships where organization_id = $1 and workspace_id = $2
           and status = 'active' and roles @> '["administrator"]'::jsonb and (valid_until is null or valid_until > $3)`,
          [context.scope.organizationId, context.scope.workspaceId, event.occurredAt],
        );
        if (Number(administrators.rows[0]?.count ?? 0) <= 1) throw new Error("The last active workspace administrator cannot be removed.");
      }
      await tx.query(
        `insert into platform_workspace_memberships (organization_id, workspace_id, principal_id, roles, status, valid_from, valid_until)
         values ($1,$2,$3,$4::jsonb,$5,$6,$7)
         on conflict (organization_id, workspace_id, principal_id) do update set roles = excluded.roles, status = excluded.status, valid_from = excluded.valid_from, valid_until = excluded.valid_until`,
        [membership.organizationId, membership.workspaceId, membership.principalId, JSON.stringify(membership.roles), membership.status, membership.validFrom, membership.validUntil],
      );
      await tx.query(
        `insert into platform_membership_events (organization_id, workspace_id, event_id, target_principal_id, actor_principal_id, occurred_at, previous_membership, next_membership)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
        [context.scope.organizationId, context.scope.workspaceId, event.eventId, membership.principalId, context.principal.principalId, event.occurredAt, previous ? JSON.stringify(previous) : null, JSON.stringify(membership)],
      );
      return Object.freeze({ ...membership, roles: Object.freeze([...membership.roles]) });
    });
  }
}

export class SqlAtomicRateLimitStore implements AtomicRateLimitStore {
  constructor(private readonly driver: TransactionalSqlDriver) {}

  async increment(key: string, windowSeconds: number, nowMs: number): Promise<{ count: number; resetAtMs: number }> {
    const now = new Date(nowMs).toISOString();
    const reset = new Date(nowMs + windowSeconds * 1_000).toISOString();
    const result = await this.driver.query<{ count: number; reset_at_ms: number | string }>(
      `insert into platform_rate_limits (rate_key, count, reset_at)
       values ($1, 1, $3::timestamptz)
       on conflict (rate_key) do update set
         count = case when platform_rate_limits.reset_at <= $2::timestamptz then 1 else platform_rate_limits.count + 1 end,
         reset_at = case when platform_rate_limits.reset_at <= $2::timestamptz then $3::timestamptz else platform_rate_limits.reset_at end
       returning count, extract(epoch from reset_at) * 1000 as reset_at_ms`,
      [key, now, reset],
    );
    const row = result.rows[0];
    if (!row || !Number.isFinite(Number(row.count)) || !Number.isFinite(Number(row.reset_at_ms))) {
      throw new Error("Atomic rate-limit increment did not return a valid row.");
    }
    return { count: Number(row.count), resetAtMs: Number(row.reset_at_ms) };
  }
}
