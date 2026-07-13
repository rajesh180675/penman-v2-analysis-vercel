/**
 * Storage tenancy vocabulary shared by repository adapters.
 *
 * A `server-session` principal is a value produced *after* a server has
 * authenticated a session.  Parsing this shape only validates its structure;
 * it does not authenticate a request and must never be used as a substitute
 * for a server-side session check.
 *
 * `local` principals are deliberately explicit.  They provide deterministic
 * namespace isolation for single-user/local mode and make no authentication
 * claim.
 */

export const LOCAL_ORGANIZATION_ID = "local" as const;

export interface ServerSessionPrincipal {
  readonly kind: "server-session";
  readonly principalId: string;
  readonly organizationId: string;
  readonly userId: string;
}

export interface LocalWorkspacePrincipal {
  readonly kind: "local";
  readonly principalId: string;
  readonly organizationId: typeof LOCAL_ORGANIZATION_ID;
  readonly userId: string;
}

export type WorkspacePrincipal = ServerSessionPrincipal | LocalWorkspacePrincipal;

export interface WorkspaceScope {
  readonly organizationId: string;
  readonly workspaceId: string;
}

export interface WorkspaceAccessContext {
  readonly principal: WorkspacePrincipal;
  readonly scope: WorkspaceScope;
}

export interface PlatformValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** Structured, payload-safe validation failure for application boundaries. */
export class PlatformValidationError extends Error {
  readonly code = "PLATFORM_INPUT_INVALID" as const;
  readonly issues: readonly PlatformValidationIssue[];

  constructor(issues: readonly PlatformValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "PlatformValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;

function fail(path: string, code: string, message: string): never {
  throw new PlatformValidationError([{ path, code, message }]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) fail(`${path}.${unexpected}`, "UNEXPECTED_FIELD", "field is not permitted");
}

export function parsePlatformIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail(
      path,
      "INVALID_IDENTIFIER",
      "must be 1-128 characters using letters, numbers, dot, underscore, colon, or hyphen",
    );
  }
  return value;
}

/**
 * Validate the serialized principal shape.  This function intentionally does
 * not verify a session, signature, role, membership, or permission.
 */
export function parseWorkspacePrincipal(value: unknown): WorkspacePrincipal {
  if (!isPlainRecord(value)) fail("principal", "INVALID_TYPE", "must be an object");
  assertOnlyKeys(value, ["kind", "principalId", "organizationId", "userId"], "principal");

  const principalId = parsePlatformIdentifier(value.principalId, "principal.principalId");
  const organizationId = parsePlatformIdentifier(value.organizationId, "principal.organizationId");
  const userId = parsePlatformIdentifier(value.userId, "principal.userId");

  if (value.kind === "local") {
    if (organizationId !== LOCAL_ORGANIZATION_ID) {
      fail(
        "principal.organizationId",
        "LOCAL_ORGANIZATION_REQUIRED",
        `local principals must use organization '${LOCAL_ORGANIZATION_ID}'`,
      );
    }
    return Object.freeze({ kind: "local", principalId, organizationId, userId });
  }

  if (value.kind === "server-session") {
    if (organizationId === LOCAL_ORGANIZATION_ID) {
      fail(
        "principal.organizationId",
        "RESERVED_ORGANIZATION",
        "server-session principals cannot use the local organization namespace",
      );
    }
    return Object.freeze({ kind: "server-session", principalId, organizationId, userId });
  }

  return fail("principal.kind", "INVALID_ENUM", "must be 'local' or 'server-session'");
}

export function parseWorkspaceScope(value: unknown): WorkspaceScope {
  if (!isPlainRecord(value)) fail("scope", "INVALID_TYPE", "must be an object");
  assertOnlyKeys(value, ["organizationId", "workspaceId"], "scope");
  return Object.freeze({
    organizationId: parsePlatformIdentifier(value.organizationId, "scope.organizationId"),
    workspaceId: parsePlatformIdentifier(value.workspaceId, "scope.workspaceId"),
  });
}

export function parseWorkspaceAccessContext(value: unknown): WorkspaceAccessContext {
  if (!isPlainRecord(value)) fail("context", "INVALID_TYPE", "must be an object");
  assertOnlyKeys(value, ["principal", "scope"], "context");
  const principal = parseWorkspacePrincipal(value.principal);
  const scope = parseWorkspaceScope(value.scope);
  if (principal.organizationId !== scope.organizationId) {
    fail(
      "context.scope.organizationId",
      "CROSS_ORGANIZATION_SCOPE",
      "must match the principal organization",
    );
  }
  return Object.freeze({ principal, scope });
}

/** Build an explicitly unauthenticated, single-user local context. */
export function createLocalWorkspaceAccessContext(
  profileId: string,
  workspaceId: string,
): WorkspaceAccessContext & { readonly principal: LocalWorkspacePrincipal } {
  const parsedProfileId = parsePlatformIdentifier(profileId, "profileId");
  const parsedWorkspaceId = parsePlatformIdentifier(workspaceId, "workspaceId");
  return Object.freeze({
    principal: Object.freeze({
      kind: "local" as const,
      principalId: parsedProfileId,
      organizationId: LOCAL_ORGANIZATION_ID,
      userId: parsedProfileId,
    }),
    scope: Object.freeze({
      organizationId: LOCAL_ORGANIZATION_ID,
      workspaceId: parsedWorkspaceId,
    }),
  });
}
