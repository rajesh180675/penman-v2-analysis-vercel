import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OidcJwksSessionVerifier, SessionVerificationError } from "./sessionVerifier";

function base64url(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }

describe("OIDC workspace session verification", () => {
  it("verifies RS256 signature, issuer, audience, time, and signed organization", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", use: "sig", alg: "RS256" };
    const now = new Date("2026-07-13T12:00:00.000Z");
    const header = base64url({ alg: "RS256", kid: "key-1", typ: "JWT" });
    const claims = base64url({ iss: "https://issuer.test", aud: "penman-platform", sub: "principal-1", organization_id: "org-1", exp: Math.floor(now.getTime() / 1_000) + 300 });
    const signingInput = `${header}.${claims}`;
    const signature = createSign("RSA-SHA256").update(signingInput).end().sign(privateKey).toString("base64url");
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("well-known")
      ? { issuer: "https://issuer.test", jwks_uri: "https://issuer.test/keys" }
      : { keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } }));
    const verifier = new OidcJwksSessionVerifier({ issuer: "https://issuer.test", audience: "penman-platform", fetchImpl: fetchImpl as typeof fetch, now: () => now });
    await expect(verifier.verifyBearerToken(`${signingInput}.${signature}`)).resolves.toEqual({ principalId: "principal-1", organizationId: "org-1", userId: "principal-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an expired token before creating a workspace principal", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", use: "sig" };
    const header = base64url({ alg: "RS256", kid: "key-1" });
    const claims = base64url({ iss: "https://issuer.test", aud: "penman-platform", sub: "principal-1", organization_id: "org-1", exp: 1 });
    const body = `${header}.${claims}`;
    const token = `${body}.${createSign("RSA-SHA256").update(body).end().sign(privateKey).toString("base64url")}`;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("well-known") ? { issuer: "https://issuer.test", jwks_uri: "https://issuer.test/keys" } : { keys: [jwk] }), { status: 200 }));
    const verifier = new OidcJwksSessionVerifier({ issuer: "https://issuer.test", audience: "penman-platform", fetchImpl: fetchImpl as typeof fetch, now: () => new Date("2026-07-13T00:00:00.000Z") });
    await expect(verifier.verifyBearerToken(token)).rejects.toMatchObject({ code: "TOKEN_CLAIMS_INVALID" } satisfies Partial<SessionVerificationError>);
  });
});
