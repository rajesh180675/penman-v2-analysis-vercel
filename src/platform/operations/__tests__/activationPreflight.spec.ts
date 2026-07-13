import { describe, expect, it } from "vitest";
import { buildPlatformActivationPreflight } from "../activationPreflight";

const strongBase64 = Buffer.alloc(32, 7).toString("base64");

function releaseEnvironment(): Record<string, string> {
  return {
    PLATFORM_DATABASE_URL: "postgresql://penman:secret@database.internal:5432/penman",
    BLOB_READ_WRITE_TOKEN: `vercel_blob_${"x".repeat(40)}`,
    PLATFORM_SESSION_ISSUER: "https://identity.example.test",
    PLATFORM_SESSION_AUDIENCE: "penman-platform",
    PLATFORM_BACKUP_HMAC_KEY_ID: "backup-2026-07",
    PLATFORM_BACKUP_HMAC_KEY_BASE64: strongBase64,
    CRON_SECRET: "c".repeat(48),
    PLATFORM_HEALTH_ORGANIZATION_ID: "org-1",
    PLATFORM_HEALTH_WORKSPACE_ID: "workspace-1",
    PLATFORM_HEALTH_TOKEN: "h".repeat(48),
    PLATFORM_OUTBOX_WEBHOOK_URL: "https://events.example.test/penman",
    PLATFORM_OUTBOX_HMAC_KEY_BASE64: strongBase64,
  };
}

describe("platform activation preflight", () => {
  it("reports every missing release prerequisite without echoing secret values", () => {
    const report = buildPlatformActivationPreflight({}, "release");
    expect(report.status).toBe("blocked");
    expect(report.missingVariables).toContain("PLATFORM_DATABASE_URL");
    expect(report.missingVariables).toContain("PLATFORM_OUTBOX_HMAC_KEY_BASE64");
    expect(JSON.stringify(report)).not.toContain("secret@");
  });

  it("accepts a complete, strongly configured release environment", () => {
    const report = buildPlatformActivationPreflight(releaseEnvironment(), "release");
    expect(report.status).toBe("ready");
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.missingVariables).toEqual([]);
    expect(report.invalidVariables).toEqual([]);
  });

  it("rejects weak secrets, non-HTTPS identity/webhooks, and invalid capacity overrides", () => {
    const environment = releaseEnvironment();
    environment.PLATFORM_SESSION_ISSUER = "http://identity.example.test";
    environment.PLATFORM_OUTBOX_WEBHOOK_URL = "http://events.example.test/penman";
    environment.PLATFORM_BACKUP_HMAC_KEY_BASE64 = Buffer.alloc(8).toString("base64");
    environment.PLATFORM_DATABASE_POOL_MAX = "0";
    const report = buildPlatformActivationPreflight(environment, "release");
    expect(report.status).toBe("blocked");
    expect(report.invalidVariables).toEqual(expect.arrayContaining([
      "PLATFORM_SESSION_ISSUER", "PLATFORM_OUTBOX_WEBHOOK_URL",
      "PLATFORM_BACKUP_HMAC_KEY_BASE64", "PLATFORM_DATABASE_POOL_MAX",
    ]));
  });

  it("allows runtime readiness to be evaluated independently of scheduled operations", () => {
    const environment = releaseEnvironment();
    delete environment.PLATFORM_BACKUP_HMAC_KEY_ID;
    delete environment.PLATFORM_BACKUP_HMAC_KEY_BASE64;
    delete environment.PLATFORM_OUTBOX_WEBHOOK_URL;
    delete environment.PLATFORM_OUTBOX_HMAC_KEY_BASE64;
    delete environment.CRON_SECRET;
    delete environment.PLATFORM_HEALTH_ORGANIZATION_ID;
    delete environment.PLATFORM_HEALTH_WORKSPACE_ID;
    delete environment.PLATFORM_HEALTH_TOKEN;
    expect(buildPlatformActivationPreflight(environment, "runtime").status).toBe("ready");
    expect(buildPlatformActivationPreflight(environment, "release").status).toBe("blocked");
  });
});
