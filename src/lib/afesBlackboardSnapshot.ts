export const AFES_BLACKBOARD_SCHEMA_VERSION = "2026-04-afes-blackboard-v1";

export interface AfesBlackboardCodeState {
  typescript_check: string | null;
  test_suite: string | null;
  deployment_status: string | null;
  last_commit: string | null;
}

export interface AfesBlackboardSnapshot {
  schemaVersion: typeof AFES_BLACKBOARD_SCHEMA_VERSION;
  session: string;
  round: number;
  agents_completed: number;
  agents_pending: number;
  consensus_score: number;
  last_updated: string | null;
  environment: Record<string, string | null>;
  findings: Record<string, Record<string, unknown>>;
  debate_log: Array<Record<string, unknown>>;
  code_state: AfesBlackboardCodeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, readFiniteNumber(value, fallback));
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function sanitizeStringRecord(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, string | null>>((acc, [key, entry]) => {
    acc[key] = typeof entry === "string" ? entry : entry == null ? null : String(entry);
    return acc;
  }, {});
}

function sanitizeFindings(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, Record<string, unknown>>>((acc, [key, entry]) => {
    if (isRecord(entry)) acc[key] = entry;
    return acc;
  }, {});
}

function sanitizeDebateLog(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function sanitizeCodeState(value: unknown): AfesBlackboardCodeState {
  if (!isRecord(value)) {
    return {
      typescript_check: null,
      test_suite: null,
      deployment_status: null,
      last_commit: null,
    };
  }

  return {
    typescript_check: readNullableString(value.typescript_check),
    test_suite: readNullableString(value.test_suite),
    deployment_status: readNullableString(value.deployment_status),
    last_commit: readNullableString(value.last_commit),
  };
}

export function buildAfesBlackboardSnapshot(
  session: string,
  overrides: Partial<Omit<AfesBlackboardSnapshot, "schemaVersion" | "session">> = {},
): AfesBlackboardSnapshot {
  return {
    schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
    session,
    round: Math.max(1, readNonNegativeNumber(overrides.round, 1)),
    agents_completed: readNonNegativeNumber(overrides.agents_completed, 0),
    agents_pending: readNonNegativeNumber(overrides.agents_pending, 0),
    consensus_score: readFiniteNumber(overrides.consensus_score, 0),
    last_updated: overrides.last_updated ?? null,
    environment: sanitizeStringRecord(overrides.environment),
    findings: sanitizeFindings(overrides.findings),
    debate_log: sanitizeDebateLog(overrides.debate_log),
    code_state: sanitizeCodeState(overrides.code_state),
  };
}

export function readAfesBlackboardSnapshot(value: unknown, fallbackSession = "default"): AfesBlackboardSnapshot {
  if (!isRecord(value)) return buildAfesBlackboardSnapshot(fallbackSession);
  if ("schemaVersion" in value && value.schemaVersion !== AFES_BLACKBOARD_SCHEMA_VERSION) {
    return buildAfesBlackboardSnapshot(fallbackSession);
  }

  const session = typeof value.session === "string" && value.session ? value.session : fallbackSession;
  return buildAfesBlackboardSnapshot(session, {
    round: readNonNegativeNumber(value.round, 1),
    agents_completed: readNonNegativeNumber(value.agents_completed, 0),
    agents_pending: readNonNegativeNumber(value.agents_pending, 0),
    consensus_score: readFiniteNumber(value.consensus_score, 0),
    last_updated: readNullableString(value.last_updated),
    environment: sanitizeStringRecord(value.environment),
    findings: sanitizeFindings(value.findings),
    debate_log: sanitizeDebateLog(value.debate_log),
    code_state: sanitizeCodeState(value.code_state),
  });
}
