export type PlatformActivationProfile = "runtime" | "operations" | "release";

export interface PlatformActivationCheck {
  readonly checkId: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly variables: readonly string[];
  readonly missingVariables: readonly string[];
  readonly invalidVariables: readonly string[];
  readonly remediation: string;
}

export interface PlatformActivationPreflight {
  readonly schemaVersion: "2026-07-platform-activation-preflight-v1";
  readonly profile: PlatformActivationProfile;
  readonly status: "ready" | "blocked";
  readonly checks: readonly PlatformActivationCheck[];
  readonly missingVariables: readonly string[];
  readonly invalidVariables: readonly string[];
}

type Environment = Readonly<Record<string, string | undefined>>;

interface Requirement {
  readonly checkId: string;
  readonly profiles: readonly PlatformActivationProfile[];
  readonly summary: string;
  readonly variables: readonly string[];
  readonly requiredVariables?: readonly string[];
  readonly remediation: string;
  readonly validate: (environment: Environment) => readonly string[];
}

function value(environment: Environment, name: string): string {
  return environment[name]?.trim() ?? "";
}

function missing(environment: Environment, names: readonly string[]): readonly string[] {
  return names.filter((name) => !value(environment, name));
}

function isPlaceholder(candidate: string): boolean {
  return /^(?:configured|change-?me|replace-?me|example|todo|xxx)$/i.test(candidate);
}

function validUrl(candidate: string, protocols: readonly string[]): boolean {
  try {
    const parsed = new URL(candidate);
    return protocols.includes(parsed.protocol) && Boolean(parsed.hostname) && !isPlaceholder(parsed.hostname);
  } catch {
    return false;
  }
}

function base64ByteLength(candidate: string): number {
  if (!candidate || candidate.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) return 0;
  const padding = candidate.endsWith("==") ? 2 : candidate.endsWith("=") ? 1 : 0;
  return (candidate.length / 4) * 3 - padding;
}

function invalidRequired(environment: Environment, validators: Readonly<Record<string, (candidate: string) => boolean>>): readonly string[] {
  return Object.entries(validators)
    .filter(([name, validator]) => {
      const candidate = value(environment, name);
      return Boolean(candidate) && !validator(candidate);
    })
    .map(([name]) => name);
}

const requirements: readonly Requirement[] = Object.freeze([
  {
    checkId: "transactional-metadata",
    profiles: ["runtime", "operations", "release"],
    summary: "PostgreSQL transactional metadata store",
    variables: ["PLATFORM_DATABASE_URL"],
    remediation: "Set a managed PostgreSQL connection URL using the postgresql:// or postgres:// protocol.",
    validate: (environment) => invalidRequired(environment, {
      PLATFORM_DATABASE_URL: (candidate) => validUrl(candidate, ["postgres:", "postgresql:"]),
    }),
  },
  {
    checkId: "artifact-object-store",
    profiles: ["runtime", "operations", "release"],
    summary: "Private durable artifact object store",
    variables: ["BLOB_READ_WRITE_TOKEN"],
    remediation: "Connect a private Vercel Blob store and set its write-enabled token.",
    validate: (environment) => invalidRequired(environment, {
      BLOB_READ_WRITE_TOKEN: (candidate) => candidate.length >= 32 && !isPlaceholder(candidate),
    }),
  },
  {
    checkId: "authenticated-session",
    profiles: ["runtime", "release"],
    summary: "HTTPS OIDC session issuer and audience",
    variables: ["PLATFORM_SESSION_ISSUER", "PLATFORM_SESSION_AUDIENCE"],
    remediation: "Configure an HTTPS OIDC issuer and the API audience accepted by the platform.",
    validate: (environment) => invalidRequired(environment, {
      PLATFORM_SESSION_ISSUER: (candidate) => validUrl(candidate, ["https:"]),
      PLATFORM_SESSION_AUDIENCE: (candidate) => candidate.length >= 3 && !isPlaceholder(candidate),
    }),
  },
  {
    checkId: "backup-authentication",
    profiles: ["operations", "release"],
    summary: "Authenticated backup signing key",
    variables: ["PLATFORM_BACKUP_HMAC_KEY_ID", "PLATFORM_BACKUP_HMAC_KEY_BASE64"],
    remediation: "Generate a named backup key with at least 256 bits of base64-encoded entropy.",
    validate: (environment) => invalidRequired(environment, {
      PLATFORM_BACKUP_HMAC_KEY_ID: (candidate) => candidate.length >= 3 && !isPlaceholder(candidate),
      PLATFORM_BACKUP_HMAC_KEY_BASE64: (candidate) => base64ByteLength(candidate) >= 32,
    }),
  },
  {
    checkId: "scheduled-operations",
    profiles: ["operations", "release"],
    summary: "Authenticated scheduled operations",
    variables: ["CRON_SECRET"],
    remediation: "Set a randomly generated cron bearer secret containing at least 32 characters.",
    validate: (environment) => invalidRequired(environment, {
      CRON_SECRET: (candidate) => candidate.length >= 32 && !isPlaceholder(candidate),
    }),
  },
  {
    checkId: "health-scope",
    profiles: ["operations", "release"],
    summary: "Authenticated workspace-scoped live health probe",
    variables: ["PLATFORM_HEALTH_ORGANIZATION_ID", "PLATFORM_HEALTH_WORKSPACE_ID", "PLATFORM_HEALTH_TOKEN"],
    remediation: "Set the health organization/workspace scope and a random health token of at least 32 characters.",
    validate: (environment) => invalidRequired(environment, {
      PLATFORM_HEALTH_ORGANIZATION_ID: (candidate) => candidate.length >= 1 && !isPlaceholder(candidate),
      PLATFORM_HEALTH_WORKSPACE_ID: (candidate) => candidate.length >= 1 && !isPlaceholder(candidate),
      PLATFORM_HEALTH_TOKEN: (candidate) => candidate.length >= 32 && !isPlaceholder(candidate),
    }),
  },
  {
    checkId: "outbox-delivery",
    profiles: ["operations", "release"],
    summary: "Authenticated HTTPS outbox delivery",
    variables: ["PLATFORM_OUTBOX_WEBHOOK_URL", "PLATFORM_OUTBOX_HMAC_KEY_BASE64"],
    remediation: "Set an HTTPS webhook receiver and a base64 HMAC key containing at least 256 bits of entropy.",
    validate: (environment) => invalidRequired(environment, {
      PLATFORM_OUTBOX_WEBHOOK_URL: (candidate) => validUrl(candidate, ["https:"]),
      PLATFORM_OUTBOX_HMAC_KEY_BASE64: (candidate) => base64ByteLength(candidate) >= 32,
    }),
  },
  {
    checkId: "bounded-capacity",
    profiles: ["runtime", "operations", "release"],
    summary: "Bounded database and scheduled-operation capacity",
    variables: [
      "PLATFORM_DATABASE_POOL_MAX", "PLATFORM_DATABASE_CONNECT_TIMEOUT_MS", "PLATFORM_DATABASE_IDLE_TIMEOUT_MS",
      "PLATFORM_OUTBOX_BATCH_SIZE", "PLATFORM_SCHEDULED_WORKSPACE_LIMIT", "PLATFORM_RESTORE_DRILL_WORKSPACE_LIMIT",
    ],
    requiredVariables: [],
    remediation: "Remove invalid overrides or set each capacity override to a positive integer within its safe bound.",
    validate: (environment) => {
      const bounds: Readonly<Record<string, readonly [number, number]>> = {
        PLATFORM_DATABASE_POOL_MAX: [1, 100],
        PLATFORM_DATABASE_CONNECT_TIMEOUT_MS: [100, 120_000],
        PLATFORM_DATABASE_IDLE_TIMEOUT_MS: [1_000, 600_000],
        PLATFORM_OUTBOX_BATCH_SIZE: [1, 500],
        PLATFORM_SCHEDULED_WORKSPACE_LIMIT: [1, 500],
        PLATFORM_RESTORE_DRILL_WORKSPACE_LIMIT: [1, 500],
      };
      return Object.entries(bounds).filter(([name, [minimum, maximum]]) => {
        const candidate = value(environment, name);
        if (!candidate) return false;
        const parsed = Number(candidate);
        return !Number.isInteger(parsed) || parsed < minimum || parsed > maximum;
      }).map(([name]) => name);
    },
  },
]);

export function buildPlatformActivationPreflight(
  environment: Environment,
  profile: PlatformActivationProfile = "release",
): PlatformActivationPreflight {
  const checks = requirements
    .filter((requirement) => requirement.profiles.includes(profile))
    .map((requirement): PlatformActivationCheck => {
      const missingVariables = missing(environment, requirement.requiredVariables ?? requirement.variables);
      const invalidVariables = requirement.validate(environment);
      return Object.freeze({
        checkId: requirement.checkId,
        passed: missingVariables.length === 0 && invalidVariables.length === 0,
        summary: requirement.summary,
        variables: Object.freeze([...requirement.variables]),
        missingVariables: Object.freeze([...missingVariables]),
        invalidVariables: Object.freeze([...invalidVariables]),
        remediation: requirement.remediation,
      });
    });
  const missingVariables = [...new Set(checks.flatMap((check) => check.missingVariables))].sort();
  const invalidVariables = [...new Set(checks.flatMap((check) => check.invalidVariables))].sort();
  return Object.freeze({
    schemaVersion: "2026-07-platform-activation-preflight-v1",
    profile,
    status: checks.every((check) => check.passed) ? "ready" : "blocked",
    checks: Object.freeze(checks),
    missingVariables: Object.freeze(missingVariables),
    invalidVariables: Object.freeze(invalidVariables),
  });
}
