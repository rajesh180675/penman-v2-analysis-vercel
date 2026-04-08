import {
  isResearchConfigured,
  maybeRequireResearchReadAuth,
  maybeRequireResearchWriteAuth,
  readJsonBlob,
  readResearchBody,
  researchPath,
  writeJsonBlob,
} from "../research/_store.js";
import { sanitizePathSegment } from "../audit/_lib.js";
import { readLocalBlackboard, writeLocalBlackboard } from "./_localStore.js";

const AFES_BLACKBOARD_SCHEMA_VERSION = "2026-04-afes-blackboard-v1";

function buildDefaultSnapshot(session) {
  return {
    schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
    session,
    round: 1,
    agents_completed: 0,
    agents_pending: 0,
    consensus_score: 0,
    last_updated: null,
    environment: {},
    findings: {},
    debate_log: [],
    code_state: {
      typescript_check: null,
      test_suite: null,
      deployment_status: null,
      last_commit: null,
    },
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableString(value) {
  return typeof value === "string" ? value : null;
}

function sanitizeStringRecord(value) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    acc[key] = typeof entry === "string" ? entry : entry == null ? null : String(entry);
    return acc;
  }, {});
}

function sanitizeFindings(value) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (isRecord(entry)) acc[key] = entry;
    return acc;
  }, {});
}

function sanitizeDebateLog(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry));
}

function sanitizeCodeState(value) {
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

function normalizeSnapshot(value, fallbackSession) {
  if (!isRecord(value)) return buildDefaultSnapshot(fallbackSession);
  if ("schemaVersion" in value && value.schemaVersion !== AFES_BLACKBOARD_SCHEMA_VERSION) {
    return buildDefaultSnapshot(fallbackSession);
  }

  const session = typeof value.session === "string" && value.session ? value.session : fallbackSession;
  return {
    schemaVersion: AFES_BLACKBOARD_SCHEMA_VERSION,
    session,
    round: Math.max(1, readFiniteNumber(value.round, 1)),
    agents_completed: Math.max(0, readFiniteNumber(value.agents_completed, 0)),
    agents_pending: Math.max(0, readFiniteNumber(value.agents_pending, 0)),
    consensus_score: readFiniteNumber(value.consensus_score, 0),
    last_updated: readNullableString(value.last_updated),
    environment: sanitizeStringRecord(value.environment),
    findings: sanitizeFindings(value.findings),
    debate_log: sanitizeDebateLog(value.debate_log),
    code_state: sanitizeCodeState(value.code_state),
  };
}

function getLatestPath(session) {
  return researchPath("afes-blackboard", session, "latest.json");
}

function getEventPath(session, operation) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return researchPath("afes-blackboard", session, "events", `${stamp}-${sanitizePathSegment(operation)}.json`);
}

function canUseLocalFallback() {
  return process.env.VERCEL !== "1";
}

function assertBlackboardConfigured(response) {
  if (isResearchConfigured() || canUseLocalFallback()) return true;
  response.status(503).json({ error: "Blackboard storage is not configured. Set BLOB_READ_WRITE_TOKEN or use local development mode." });
  return false;
}

async function readSnapshot(session) {
  const [blobCurrent, localCurrent] = await Promise.all([
    isResearchConfigured() ? readJsonBlob(getLatestPath(session)).catch(() => null) : Promise.resolve(null),
    canUseLocalFallback() ? readLocalBlackboard(session) : Promise.resolve(null),
  ]);

  const blobSnapshot = blobCurrent ? normalizeSnapshot(blobCurrent, session) : null;
  const localSnapshot = localCurrent ? normalizeSnapshot(localCurrent, session) : null;

  if (blobSnapshot && localSnapshot) {
    const blobTs = Date.parse(blobSnapshot.last_updated ?? "") || 0;
    const localTs = Date.parse(localSnapshot.last_updated ?? "") || 0;
    return localTs > blobTs
      ? { snapshot: localSnapshot, mode: "local-only" }
      : { snapshot: blobSnapshot, mode: "blob" };
  }

  if (blobSnapshot) return { snapshot: blobSnapshot, mode: "blob" };
  if (localSnapshot) return { snapshot: localSnapshot, mode: "local-only" };
  return { snapshot: buildDefaultSnapshot(session), mode: "empty" };
}

function appendUniqueDebateEntry(existingEntries, entry) {
  const entryKey = JSON.stringify(entry);
  return existingEntries.some((candidate) => JSON.stringify(candidate) === entryKey)
    ? existingEntries
    : [...existingEntries, entry];
}

function mergeFindings(existingFindings, key, finding) {
  const previous = existingFindings[key];
  if (!isRecord(previous)) return { ...existingFindings, [key]: finding };
  return {
    ...existingFindings,
    [key]: {
      ...previous,
      ...finding,
    },
  };
}

function mergeSnapshot(snapshot, operation, payload) {
  const next = {
    ...snapshot,
    last_updated: new Date().toISOString(),
  };

  if (operation === "upsert-finding") {
    const key = sanitizePathSegment(payload.findingKey || payload.agentId || "unknown-agent");
    if (!isRecord(payload.finding)) return null;
    next.findings = mergeFindings(snapshot.findings, key, payload.finding);
    return next;
  }

  if (operation === "append-debate-log") {
    if (!isRecord(payload.entry)) return null;
    next.debate_log = appendUniqueDebateEntry(snapshot.debate_log, payload.entry);
    return next;
  }

  if (operation === "patch-code-state") {
    if (!isRecord(payload.code_state)) return null;
    next.code_state = {
      ...snapshot.code_state,
      ...sanitizeCodeState({ ...snapshot.code_state, ...payload.code_state }),
    };
    return next;
  }

  if (operation === "patch-session-metadata") {
    next.round = payload.round == null ? snapshot.round : Math.max(1, readFiniteNumber(payload.round, snapshot.round));
    next.agents_completed = payload.agents_completed == null ? snapshot.agents_completed : Math.max(0, readFiniteNumber(payload.agents_completed, snapshot.agents_completed));
    next.agents_pending = payload.agents_pending == null ? snapshot.agents_pending : Math.max(0, readFiniteNumber(payload.agents_pending, snapshot.agents_pending));
    next.consensus_score = payload.consensus_score == null ? snapshot.consensus_score : readFiniteNumber(payload.consensus_score, snapshot.consensus_score);
    next.environment = isRecord(payload.environment)
      ? { ...snapshot.environment, ...sanitizeStringRecord(payload.environment) }
      : snapshot.environment;
    return next;
  }

  if (operation === "replace-snapshot") {
    if (!isRecord(payload.snapshot)) return null;
    return normalizeSnapshot(payload.snapshot, snapshot.session);
  }

  return null;
}

async function persistSnapshot(session, operation, body, next, response) {
  const eventPayload = {
    session,
    operation,
    agentId: typeof body.agentId === "string" ? body.agentId : null,
    storedAt: new Date().toISOString(),
    payload: body,
  };

  let wroteBlob = false;
  if (isResearchConfigured()) {
    try {
      await Promise.all([
        writeJsonBlob(getLatestPath(session), next),
        writeJsonBlob(getEventPath(session, operation), eventPayload),
      ]);
      wroteBlob = true;
    } catch {
      wroteBlob = false;
    }
  }

  let wroteLocal = false;
  if (canUseLocalFallback()) {
    try {
      await writeLocalBlackboard(session, next);
      wroteLocal = true;
    } catch {
      wroteLocal = false;
    }
  }

  const mode = wroteBlob && wroteLocal ? "blob+local"
    : wroteBlob ? "blob"
      : wroteLocal ? "local-only"
        : "failed";

  if (mode === "failed") {
    response.status(503).json({ error: "Blackboard write failed in all configured storage modes." });
    return null;
  }

  if (mode === "local-only" && !canUseLocalFallback()) {
    response.status(503).json({ error: "Local-only blackboard persistence is not allowed in deployed runtime." });
    return null;
  }

  return mode;
}

export default async function handler(request, response) {
  if (!assertBlackboardConfigured(response)) return;

  const sessionQuery = typeof request.query?.session === "string" ? sanitizePathSegment(request.query.session) : null;

  if (request.method === "GET") {
    if (!maybeRequireResearchReadAuth(request, response)) return;
    if (!sessionQuery) {
      response.status(400).json({ error: "session is required." });
      return;
    }
    const { snapshot, mode } = await readSnapshot(sessionQuery);
    response.status(200).json({ ...snapshot, mode });
    return;
  }

  if (request.method === "POST") {
    if (!maybeRequireResearchWriteAuth(request, response)) return;
    const body = await readResearchBody(request, response, 2 * 1024 * 1024);
    if (!body) return;

    const session = typeof body.session === "string" && body.session ? sanitizePathSegment(body.session) : null;
    const operation = typeof body.operation === "string" ? body.operation : null;
    if (!session) {
      response.status(400).json({ error: "session is required." });
      return;
    }
    if (!operation) {
      response.status(400).json({ error: "operation is required." });
      return;
    }

    const { snapshot: current } = await readSnapshot(session);
    const next = mergeSnapshot(current, operation, body);
    if (!next) {
      response.status(400).json({ error: "Invalid blackboard operation payload.", operation });
      return;
    }

    const mode = await persistSnapshot(session, operation, body, next, response);
    if (!mode) return;

    response.status(200).json({ ok: true, session, operation, mode, snapshot: next });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
