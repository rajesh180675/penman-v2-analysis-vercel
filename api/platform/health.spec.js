import { describe, expect, it } from "vitest";
import { buildPlatformConfigurationHealth } from "./health.js";

describe("platform deployment health", () => {
  it("fails closed until every durable provider boundary is configured", () => {
    expect(buildPlatformConfigurationHealth({}).status).toBe("blocked");
    const hmac = Buffer.alloc(32, 1).toString("base64");
    expect(buildPlatformConfigurationHealth({
      PLATFORM_DATABASE_URL: "postgresql://user:password@database.internal:5432/penman",
      BLOB_READ_WRITE_TOKEN: `vercel_blob_${"x".repeat(40)}`,
      PLATFORM_SESSION_ISSUER: "https://identity.example.test",
      PLATFORM_SESSION_AUDIENCE: "penman-platform",
      PLATFORM_BACKUP_HMAC_KEY_ID: "key-1",
      PLATFORM_BACKUP_HMAC_KEY_BASE64: hmac,
      CRON_SECRET: "c".repeat(48),
      PLATFORM_HEALTH_ORGANIZATION_ID: "org-1",
      PLATFORM_HEALTH_WORKSPACE_ID: "ws-1",
      PLATFORM_HEALTH_TOKEN: "h".repeat(48),
      PLATFORM_OUTBOX_WEBHOOK_URL: "https://events.example.test/penman",
      PLATFORM_OUTBOX_HMAC_KEY_BASE64: hmac,
    }).status).toBe("configured");
  });

  it("rejects present but unsafe production configuration", () => {
    const health = buildPlatformConfigurationHealth({
      PLATFORM_DATABASE_URL: "configured",
      BLOB_READ_WRITE_TOKEN: "short",
      PLATFORM_SESSION_ISSUER: "http://identity.example.test",
      PLATFORM_SESSION_AUDIENCE: "configured",
    });
    expect(health.status).toBe("blocked");
    expect(health.invalidVariables).toEqual(expect.arrayContaining([
      "PLATFORM_DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "PLATFORM_SESSION_ISSUER",
    ]));
  });
});
