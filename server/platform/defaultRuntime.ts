import { Pool } from "pg";
import { PostgresPoolDriver } from "./postgresDriver";
import { VercelBlobObjectStore } from "./vercelBlobObjectStore";
import { createProductionPlatformRuntime } from "./runtimeFactory";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the production platform runtime.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

let pool: Pool | null = null;

/** Shared, bounded PostgreSQL pool suitable for long-lived Node and warm serverless instances. */
export function getDefaultPlatformPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: requiredEnvironment("PLATFORM_DATABASE_URL"),
    max: positiveInteger("PLATFORM_DATABASE_POOL_MAX", 5),
    connectionTimeoutMillis: positiveInteger("PLATFORM_DATABASE_CONNECT_TIMEOUT_MS", 10_000),
    idleTimeoutMillis: positiveInteger("PLATFORM_DATABASE_IDLE_TIMEOUT_MS", 30_000),
    allowExitOnIdle: true,
    application_name: "penman-valuation-platform",
  });
  pool.on("error", (error) => {
    // Avoid logging connection strings or query data while still surfacing an
    // operational signal from idle clients.
    console.error("Platform PostgreSQL idle-client error", error.name, error.message);
  });
  return pool;
}

/** Minimal adapters consumed by migration, backup, restore, and probe tooling. */
export function createPlatformRuntime() {
  return Object.freeze({
    sql: new PostgresPoolDriver(getDefaultPlatformPool()),
    objects: new VercelBlobObjectStore(),
  });
}

/** Complete authenticated HTTP/application runtime. Migrations remain an explicit operator step. */
export function createDefaultProductionPlatformRuntime() {
  const organizationClaim = process.env.PLATFORM_SESSION_ORGANIZATION_CLAIM?.trim();
  const userIdClaim = process.env.PLATFORM_SESSION_USER_ID_CLAIM?.trim();
  return createProductionPlatformRuntime({
    pool: getDefaultPlatformPool(),
    oidc: {
      issuer: requiredEnvironment("PLATFORM_SESSION_ISSUER"),
      audience: requiredEnvironment("PLATFORM_SESSION_AUDIENCE"),
      ...(organizationClaim ? { organizationClaim } : {}),
      ...(userIdClaim ? { userIdClaim } : {}),
    },
  });
}
