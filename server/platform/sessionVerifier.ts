import type { NextFunction, Request, Response } from "express";
import { parsePlatformIdentifier, parseWorkspaceAccessContext, type WorkspaceAccessContext } from "../../src/platform/workspaceScope";

interface JwtHeader { readonly alg?: unknown; readonly kid?: unknown; readonly typ?: unknown; }
interface JwtClaims extends Record<string, unknown> { readonly iss?: unknown; readonly aud?: unknown; readonly sub?: unknown; readonly exp?: unknown; readonly nbf?: unknown; }
type OidcJwk = JsonWebKey & { readonly kid?: string; readonly use?: string; readonly kty?: string };
interface JsonWebKeySet { readonly keys?: readonly OidcJwk[]; }

export interface VerifiedSessionVerifier {
  verifyBearerToken(token: string): Promise<{ readonly principalId: string; readonly organizationId: string; readonly userId: string }>;
}

export class SessionVerificationError extends Error {
  constructor(readonly code: "TOKEN_MISSING" | "TOKEN_MALFORMED" | "TOKEN_ALGORITHM_REJECTED" | "TOKEN_KEY_NOT_FOUND" | "TOKEN_SIGNATURE_INVALID" | "TOKEN_CLAIMS_INVALID" | "WORKSPACE_REQUIRED", message: string) {
    super(message); this.name = "SessionVerificationError";
  }
}

function decodeSegment<T>(segment: string): T {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T; }
  catch { throw new SessionVerificationError("TOKEN_MALFORMED", "The bearer token is not valid compact JWT JSON."); }
}

function audienceMatches(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.some((item) => item === expected));
}

export interface OidcSessionVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly organizationClaim?: string;
  readonly userIdClaim?: string;
  readonly clockSkewSeconds?: number;
  readonly jwksCacheSeconds?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

/** Strict RS256 OIDC verifier with discovery/JWKS caching and signed organization claims. */
export class OidcJwksSessionVerifier implements VerifiedSessionVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #organizationClaim: string;
  readonly #userIdClaim: string;
  readonly #skew: number;
  readonly #ttl: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  #cache: { readonly expiresAt: number; readonly keys: readonly OidcJwk[] } | null = null;

  constructor(options: OidcSessionVerifierOptions) {
    this.#issuer = options.issuer.replace(/\/$/, "");
    this.#audience = options.audience;
    this.#organizationClaim = options.organizationClaim ?? "organization_id";
    this.#userIdClaim = options.userIdClaim ?? "sub";
    this.#skew = options.clockSkewSeconds ?? 60;
    this.#ttl = options.jwksCacheSeconds ?? 300;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    if (!this.#issuer.startsWith("https://") || !this.#audience || this.#skew < 0 || this.#ttl < 1) throw new Error("OIDC verifier configuration is invalid.");
  }

  async #keys(force = false): Promise<readonly OidcJwk[]> {
    const now = this.#now().getTime();
    if (!force && this.#cache && this.#cache.expiresAt > now) return this.#cache.keys;
    const discoveryResponse = await this.#fetch(`${this.#issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
    if (!discoveryResponse.ok) throw new SessionVerificationError("TOKEN_KEY_NOT_FOUND", "OIDC discovery is unavailable.");
    const discovery = await discoveryResponse.json() as { issuer?: unknown; jwks_uri?: unknown };
    if (discovery.issuer !== this.#issuer || typeof discovery.jwks_uri !== "string" || !discovery.jwks_uri.startsWith("https://")) throw new SessionVerificationError("TOKEN_KEY_NOT_FOUND", "OIDC discovery metadata is invalid.");
    const jwksResponse = await this.#fetch(discovery.jwks_uri, { headers: { accept: "application/json" } });
    if (!jwksResponse.ok) throw new SessionVerificationError("TOKEN_KEY_NOT_FOUND", "OIDC signing keys are unavailable.");
    const jwks = await jwksResponse.json() as JsonWebKeySet;
    const keys = Object.freeze([...(jwks.keys ?? [])].filter((key) => key.kty === "RSA" && key.use !== "enc"));
    if (!keys.length) throw new SessionVerificationError("TOKEN_KEY_NOT_FOUND", "OIDC published no usable signing keys.");
    this.#cache = { expiresAt: now + this.#ttl * 1_000, keys };
    return keys;
  }

  async verifyBearerToken(token: string) {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => !segment)) throw new SessionVerificationError("TOKEN_MALFORMED", "Bearer token must use compact JWT serialization.");
    const header = decodeSegment<JwtHeader>(segments[0]!);
    const claims = decodeSegment<JwtClaims>(segments[1]!);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw new SessionVerificationError("TOKEN_ALGORITHM_REJECTED", "Only keyed RS256 session tokens are accepted.");
    let keys = await this.#keys();
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) { keys = await this.#keys(true); jwk = keys.find((key) => key.kid === header.kid); }
    if (!jwk) throw new SessionVerificationError("TOKEN_KEY_NOT_FOUND", "The session signing key is unknown.");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
    const signature = Buffer.from(segments[2]!, "base64url");
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed)) throw new SessionVerificationError("TOKEN_SIGNATURE_INVALID", "The session signature is invalid.");
    const now = Math.floor(this.#now().getTime() / 1_000);
    if (claims.iss !== this.#issuer || !audienceMatches(claims.aud, this.#audience)
      || typeof claims.sub !== "string" || !claims.sub
      || typeof claims.exp !== "number" || claims.exp <= now - this.#skew
      || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + this.#skew))) {
      throw new SessionVerificationError("TOKEN_CLAIMS_INVALID", "Session issuer, audience, subject, or validity window is invalid.");
    }
    const organizationId = claims[this.#organizationClaim];
    const userId = claims[this.#userIdClaim];
    return Object.freeze({
      principalId: parsePlatformIdentifier(claims.sub, "session.sub"),
      organizationId: parsePlatformIdentifier(organizationId, `session.${this.#organizationClaim}`),
      userId: parsePlatformIdentifier(userId, `session.${this.#userIdClaim}`),
    });
  }
}

export function createVerifiedWorkspaceMiddleware(verifier: VerifiedSessionVerifier) {
  return async function verifiedWorkspaceMiddleware(request: Request, response: Response, next: NextFunction) {
    try {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) throw new SessionVerificationError("TOKEN_MISSING", "A bearer session token is required.");
      const workspaceHeader = request.headers["x-workspace-id"];
      const workspaceId = parsePlatformIdentifier(Array.isArray(workspaceHeader) ? workspaceHeader[0] : workspaceHeader, "x-workspace-id");
      const session = await verifier.verifyBearerToken(authorization.slice(7));
      const context: WorkspaceAccessContext = parseWorkspaceAccessContext({
        principal: { kind: "server-session", ...session },
        scope: { organizationId: session.organizationId, workspaceId },
      });
      response.locals.workspaceContext = context;
      next();
    } catch (error) {
      const known = error instanceof SessionVerificationError;
      response.setHeader("Cache-Control", "no-store");
      response.status(known && error.code === "WORKSPACE_REQUIRED" ? 400 : 401).json({ ok: false, error: known ? error.code : "SESSION_INVALID" });
    }
  };
}

export function requireVerifiedWorkspaceContext(response: Response): WorkspaceAccessContext {
  const value = response.locals.workspaceContext;
  if (!value) throw new SessionVerificationError("TOKEN_MISSING", "Verified workspace context is unavailable.");
  return value as WorkspaceAccessContext;
}
