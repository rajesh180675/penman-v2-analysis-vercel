import {
  ANALYSIS_RUN_SCHEMA_VERSION,
  ANALYSIS_STAGE_ORDER,
  type AnalysisContentKind,
  type AnalysisRunDraftV1,
  type AnalysisRunStatus,
  type AnalysisStageId,
  type ContentRef,
  type GateStatus,
  type Sha256ContentId,
} from "../../engine/analysisRun/contracts";
import {
  PlatformValidationError,
  parsePlatformIdentifier,
} from "../workspaceScope";
import type { AnalysisRunLifecycle, RunQuery } from "./contracts";

export const MAX_ANALYSIS_RUN_METADATA_BYTES = 2_000_000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const MAX_RUN_PAGE_SIZE = 100;

const CONTENT_KINDS: readonly AnalysisContentKind[] = [
  "fact-set",
  "policy-bundle",
  "model-catalog",
  "family-analysis",
  "analysis-window",
  "market-snapshot",
  "assumption-set",
  "forecast-case",
  "model-result",
  "synthesis",
  "publication",
  "diagnostic",
  "evidence",
];
const ANALYSIS_STATUSES: readonly AnalysisRunStatus[] = ["running", "completed", "blocked", "failed"];
const GATE_STATUSES: readonly GateStatus[] = [
  "passed",
  "warned",
  "failed",
  "insufficient-evidence",
  "not-applicable",
  "observed-not-enforced",
];
const FAMILIES = ["industrial", "bank", "nbfc", "insurance", "telecom", "utility"] as const;
const FORK_REASONS = [
  "assumption-change",
  "market-refresh",
  "policy-upgrade",
  "model-upgrade",
  "source-restatement",
  "manual-rerun",
] as const;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,199})$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function fail(path: string, code: string, message: string): never {
  throw new PlatformValidationError([{ path, code, message }]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) return fail(path, "INVALID_TYPE", "must be an object");
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  options: { readonly minimum?: number; readonly maximum?: number } = {},
): string {
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 256;
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    return fail(path, "INVALID_STRING", `must contain ${minimum}-${maximum} characters`);
  }
  if (/\p{C}/u.test(value)) return fail(path, "CONTROL_CHARACTER", "must not contain control characters");
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) fail(`${path}.${unexpected}`, "UNEXPECTED_FIELD", "field is not permitted");
}

function isoInstant(value: unknown, path: string): string {
  const text = boundedString(value, path, { maximum: 64 });
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) {
    return fail(path, "INVALID_TIMESTAMP", "must be an ISO-8601 timestamp");
  }
  return text;
}

function isoDate(value: unknown, path: string): string {
  const text = boundedString(value, path, { minimum: 10, maximum: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return fail(path, "INVALID_DATE", "must use YYYY-MM-DD");
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return fail(path, "INVALID_DATE", "must be a real calendar date");
  }
  return text;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "INVALID_TYPE", "must be a boolean");
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    return fail(path, "INVALID_INTEGER", "must be a non-negative integer");
  }
  return value as number;
}

function sha256(value: unknown, path: string): Sha256ContentId {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return fail(path, "INVALID_CONTENT_HASH", "must be a lowercase algorithm-prefixed SHA-256 digest");
  }
  return value as Sha256ContentId;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return fail(path, "INVALID_ENUM", `must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function nullableRef<TKind extends AnalysisContentKind>(
  value: unknown,
  kind: TKind,
  path: string,
): ContentRef<TKind> | null {
  return value === null ? null : contentRef(value, kind, path);
}

function contentRef<TKind extends AnalysisContentKind>(
  value: unknown,
  expectedKind: TKind | null,
  path: string,
): ContentRef<TKind> {
  const item = record(value, path);
  exactKeys(item, ["kind", "contentHash", "mediaType", "byteLength", "schemaVersion"], path);
  const kind = oneOf(item.kind, CONTENT_KINDS, `${path}.kind`);
  if (expectedKind !== null && kind !== expectedKind) {
    fail(`${path}.kind`, "CONTENT_KIND_MISMATCH", `must be '${expectedKind}'`);
  }
  const byteLength = nonNegativeInteger(item.byteLength, `${path}.byteLength`);
  if (byteLength > 2_147_483_647) {
    fail(`${path}.byteLength`, "CONTENT_TOO_LARGE", "must not exceed 2,147,483,647 bytes");
  }
  return {
    kind: kind as TKind,
    contentHash: sha256(item.contentHash, `${path}.contentHash`),
    mediaType: boundedString(item.mediaType, `${path}.mediaType`, { maximum: 128 }),
    byteLength,
    schemaVersion: boundedString(item.schemaVersion, `${path}.schemaVersion`, { maximum: 128 }),
  };
}

function refArray<TKind extends AnalysisContentKind>(
  value: unknown,
  expectedKind: TKind | null,
  path: string,
): readonly ContentRef<TKind>[] {
  if (!Array.isArray(value)) return fail(path, "INVALID_TYPE", "must be an array");
  return value.map((item, index) => contentRef(item, expectedKind, `${path}[${index}]`));
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) return fail(path, "INVALID_TYPE", "must be an array");
  return value.map((item, index) => boundedString(item, `${path}[${index}]`));
}

function validateJsonValue(value: unknown, path: string, seen: WeakSet<object>, depth: number): void {
  if (depth > 64) fail(path, "MAXIMUM_DEPTH", "must not exceed 64 nested levels");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "NON_FINITE_NUMBER", "numbers must be finite");
    return;
  }
  if (typeof value !== "object") fail(path, "NON_JSON_VALUE", "must contain JSON-compatible values only");
  if (seen.has(value)) fail(path, "CYCLIC_VALUE", "must not contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, seen, depth + 1));
  } else {
    if (!isPlainRecord(value)) fail(path, "NON_PLAIN_OBJECT", "must contain plain objects only");
    for (const [key, item] of Object.entries(value)) {
      validateJsonValue(item, `${path}.${key}`, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function validateTrustEnvelope(value: unknown, runId: string): void {
  const envelope = record(value, "run.trustEnvelope");
  validateJsonValue(envelope, "run.trustEnvelope", new WeakSet<object>(), 0);
  boundedString(envelope.schemaVersion, "run.trustEnvelope.schemaVersion", { maximum: 128 });
  if (envelope.generatedAt !== null) isoInstant(envelope.generatedAt, "run.trustEnvelope.generatedAt");
  const runContext = record(envelope.runContext, "run.trustEnvelope.runContext");
  if (runContext.runId !== runId) {
    fail("run.trustEnvelope.runContext.runId", "RUN_CONTEXT_MISMATCH", "must match run.runId");
  }
  boundedString(runContext.companyId, "run.trustEnvelope.runContext.companyId", { maximum: 256 });
  if (runContext.sourceMode !== null) {
    boundedString(runContext.sourceMode, "run.trustEnvelope.runContext.sourceMode", { maximum: 128 });
  }
  nonNegativeInteger(runContext.periodCount, "run.trustEnvelope.runContext.periodCount");
  if (runContext.latestPeriod !== null) isoDate(runContext.latestPeriod, "run.trustEnvelope.runContext.latestPeriod");
  const confidence = record(envelope.confidence, "run.trustEnvelope.confidence");
  oneOf(confidence.status, ["production-ready", "guarded", "blocked"] as const, "run.trustEnvelope.confidence.status");
  oneOf(confidence.tone, ["emerald", "amber", "red"] as const, "run.trustEnvelope.confidence.tone");
  boundedString(confidence.headline, "run.trustEnvelope.confidence.headline", { maximum: 2_000 });
  nonNegativeInteger(confidence.blockingCount, "run.trustEnvelope.confidence.blockingCount");
  nonNegativeInteger(confidence.diagnosticCount, "run.trustEnvelope.confidence.diagnosticCount");
  nonNegativeInteger(confidence.optionalCount, "run.trustEnvelope.confidence.optionalCount");
}

function validateStageResult(value: unknown, index: number): AnalysisStageId {
  const path = `run.stageResults[${index}]`;
  const stage = record(value, path);
  const status = oneOf(
    stage.status,
    ["not-started", "running", "completed", "diagnostic-only", "blocked", "failed"] as const,
    `${path}.status`,
  );
  const variantKeys = status === "failed"
    ? ["errorCode"]
    : status === "blocked" || status === "diagnostic-only"
      ? ["blockerGateIds"]
      : [];
  exactKeys(stage, [
    "stageId",
    "stageVersion",
    "sequence",
    "inputRefs",
    "outputRefs",
    "evidenceRefs",
    "diagnosticRefs",
    "status",
    "blocksNext",
    "reasonCode",
    ...variantKeys,
  ], path);
  const stageId = oneOf(stage.stageId, ANALYSIS_STAGE_ORDER, `${path}.stageId`);
  boundedString(stage.stageVersion, `${path}.stageVersion`, { maximum: 128 });
  nonNegativeInteger(stage.sequence, `${path}.sequence`);
  refArray(stage.inputRefs, null, `${path}.inputRefs`);
  refArray(stage.outputRefs, null, `${path}.outputRefs`);
  refArray(stage.evidenceRefs, null, `${path}.evidenceRefs`);
  refArray(stage.diagnosticRefs, "diagnostic", `${path}.diagnosticRefs`);
  const blocksNext = boolean(stage.blocksNext, `${path}.blocksNext`);
  if (status === "completed" && (blocksNext || stage.reasonCode !== null)) {
    fail(path, "INCOHERENT_STAGE_STATE", "completed stages must be non-blocking with a null reason");
  }
  if ((status === "not-started" || status === "running") && (!blocksNext || stage.reasonCode !== null)) {
    fail(path, "INCOHERENT_STAGE_STATE", "pending stages must block with a null reason");
  }
  if (status === "blocked" || status === "diagnostic-only") {
    if (!blocksNext) fail(path, "INCOHERENT_STAGE_STATE", "blocked stages must block progression");
    boundedString(stage.reasonCode, `${path}.reasonCode`, { maximum: 256 });
    stringArray(stage.blockerGateIds, `${path}.blockerGateIds`);
  }
  if (status === "failed") {
    if (!blocksNext) fail(path, "INCOHERENT_STAGE_STATE", "failed stages must block progression");
    boundedString(stage.reasonCode, `${path}.reasonCode`, { maximum: 256 });
    boundedString(stage.errorCode, `${path}.errorCode`, { maximum: 256 });
  }
  return stageId;
}

function validateGateResult(value: unknown, index: number): string {
  const path = `run.gateResults[${index}]`;
  const gate = record(value, path);
  exactKeys(gate, [
    "gateId",
    "gateVersion",
    "stage",
    "status",
    "blocksNext",
    "evidenceRefs",
    "checks",
    "summary",
  ], path);
  const gateId = boundedString(gate.gateId, `${path}.gateId`, { maximum: 256 });
  boundedString(gate.gateVersion, `${path}.gateVersion`, { maximum: 128 });
  oneOf(gate.stage, ANALYSIS_STAGE_ORDER, `${path}.stage`);
  oneOf(gate.status, GATE_STATUSES, `${path}.status`);
  boolean(gate.blocksNext, `${path}.blocksNext`);
  refArray(gate.evidenceRefs, null, `${path}.evidenceRefs`);
  boundedString(gate.summary, `${path}.summary`, { maximum: 10_000 });
  if (!Array.isArray(gate.checks)) fail(`${path}.checks`, "INVALID_TYPE", "must be an array");
  const checkIds = new Set<string>();
  gate.checks.forEach((value, checkIndex) => {
    const checkPath = `${path}.checks[${checkIndex}]`;
    const check = record(value, checkPath);
    exactKeys(check, [
      "checkId",
      "label",
      "status",
      "blocksGate",
      "observed",
      "threshold",
      "unit",
      "evidenceRefs",
      "summary",
    ], checkPath);
    const checkId = boundedString(check.checkId, `${checkPath}.checkId`, { maximum: 256 });
    if (checkIds.has(checkId)) fail(`${checkPath}.checkId`, "DUPLICATE_ID", "must be unique within a gate");
    checkIds.add(checkId);
    boundedString(check.label, `${checkPath}.label`, { maximum: 1_000 });
    oneOf(check.status, GATE_STATUSES, `${checkPath}.status`);
    boolean(check.blocksGate, `${checkPath}.blocksGate`);
    validateJsonValue(check.observed, `${checkPath}.observed`, new WeakSet<object>(), 0);
    validateJsonValue(check.threshold, `${checkPath}.threshold`, new WeakSet<object>(), 0);
    if (check.unit !== null) boundedString(check.unit, `${checkPath}.unit`, { maximum: 128 });
    refArray(check.evidenceRefs, null, `${checkPath}.evidenceRefs`);
    boundedString(check.summary, `${checkPath}.summary`, { maximum: 10_000 });
  });
  return gateId;
}

function validateRelation(value: unknown): void {
  const relation = record(value, "run.relation");
  if (relation.kind === "root") {
    exactKeys(relation, ["kind", "parentRunId", "parentReproducibilityHash"], "run.relation");
    if (relation.parentRunId !== null || relation.parentReproducibilityHash !== null) {
      fail("run.relation", "INCOHERENT_ROOT_RELATION", "root runs cannot name a parent");
    }
    return;
  }
  if (relation.kind === "child") {
    exactKeys(
      relation,
      ["kind", "parentRunId", "parentReproducibilityHash", "forkReason"],
      "run.relation",
    );
    parsePlatformIdentifier(relation.parentRunId, "run.relation.parentRunId");
    sha256(relation.parentReproducibilityHash, "run.relation.parentReproducibilityHash");
    oneOf(relation.forkReason, FORK_REASONS, "run.relation.forkReason");
    return;
  }
  fail("run.relation.kind", "INVALID_ENUM", "must be 'root' or 'child'");
}

/** Runtime validation for an untrusted value entering the run repository. */
export function parseAnalysisRunDraftV1(value: unknown): AnalysisRunDraftV1 {
  const run = record(value, "run");
  exactKeys(run, [
    "schemaVersion",
    "executorVersion",
    "derivationMode",
    "issuerId",
    "family",
    "asOf",
    "status",
    "sourceArtifactIds",
    "factSetRef",
    "policyBundleRef",
    "modelCatalogRef",
    "familyAnalysisRef",
    "analysisWindowRef",
    "marketSnapshotRef",
    "assumptionSetRef",
    "forecastCaseRefs",
    "modelResultRefs",
    "synthesisRef",
    "stageResults",
    "gateResults",
    "trustEnvelope",
    "publicationRef",
    "runId",
    "relation",
    "createdAt",
  ], "run");
  if (run.schemaVersion !== ANALYSIS_RUN_SCHEMA_VERSION) {
    fail("run.schemaVersion", "UNSUPPORTED_SCHEMA", `must be '${ANALYSIS_RUN_SCHEMA_VERSION}'`);
  }
  boundedString(run.executorVersion, "run.executorVersion", { maximum: 128 });
  oneOf(run.derivationMode, ["native", "legacy-derived"] as const, "run.derivationMode");
  parsePlatformIdentifier(run.issuerId, "run.issuerId");
  if (run.family !== null) oneOf(run.family, FAMILIES, "run.family");
  isoDate(run.asOf, "run.asOf");
  oneOf(run.status, ANALYSIS_STATUSES, "run.status");
  if (!Array.isArray(run.sourceArtifactIds)) {
    fail("run.sourceArtifactIds", "INVALID_TYPE", "must be an array");
  }
  const sourceIds = run.sourceArtifactIds.map((item, index) => sha256(item, `run.sourceArtifactIds[${index}]`));
  if (new Set(sourceIds).size !== sourceIds.length) {
    fail("run.sourceArtifactIds", "DUPLICATE_ID", "must not contain duplicate content hashes");
  }
  contentRef(run.factSetRef, "fact-set", "run.factSetRef");
  contentRef(run.policyBundleRef, "policy-bundle", "run.policyBundleRef");
  contentRef(run.modelCatalogRef, "model-catalog", "run.modelCatalogRef");
  nullableRef(run.familyAnalysisRef, "family-analysis", "run.familyAnalysisRef");
  nullableRef(run.analysisWindowRef, "analysis-window", "run.analysisWindowRef");
  nullableRef(run.marketSnapshotRef, "market-snapshot", "run.marketSnapshotRef");
  nullableRef(run.assumptionSetRef, "assumption-set", "run.assumptionSetRef");
  refArray(run.forecastCaseRefs, "forecast-case", "run.forecastCaseRefs");
  refArray(run.modelResultRefs, "model-result", "run.modelResultRefs");
  nullableRef(run.synthesisRef, "synthesis", "run.synthesisRef");
  nullableRef(run.publicationRef, "publication", "run.publicationRef");

  if (!Array.isArray(run.stageResults)) fail("run.stageResults", "INVALID_TYPE", "must be an array");
  const stageIds = run.stageResults.map(validateStageResult);
  if (new Set(stageIds).size !== stageIds.length) {
    fail("run.stageResults", "DUPLICATE_STAGE", "must contain at most one result per stage");
  }
  if (!Array.isArray(run.gateResults)) fail("run.gateResults", "INVALID_TYPE", "must be an array");
  const gateIds = run.gateResults.map(validateGateResult);
  if (new Set(gateIds).size !== gateIds.length) {
    fail("run.gateResults", "DUPLICATE_GATE", "must contain unique gate identifiers");
  }

  const runId = parsePlatformIdentifier(run.runId, "run.runId");
  validateTrustEnvelope(run.trustEnvelope, runId);
  validateRelation(run.relation);
  isoInstant(run.createdAt, "run.createdAt");
  validateJsonValue(run, "run", new WeakSet<object>(), 0);
  const encodedBytes = new TextEncoder().encode(JSON.stringify(run)).byteLength;
  if (encodedBytes > MAX_ANALYSIS_RUN_METADATA_BYTES) {
    fail("run", "METADATA_TOO_LARGE", `must not exceed ${MAX_ANALYSIS_RUN_METADATA_BYTES} bytes`);
  }
  return run as unknown as AnalysisRunDraftV1;
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) {
    return fail(
      "idempotencyKey",
      "INVALID_IDEMPOTENCY_KEY",
      `must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters using letters, numbers, dot, underscore, colon, or hyphen`,
    );
  }
  return value;
}

export function parseExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    return fail("expectedRevision", "INVALID_REVISION", "must be a positive integer");
  }
  return value as number;
}

export function parseRunId(value: unknown): string {
  return parsePlatformIdentifier(value, "runId");
}

export interface ParsedRunQuery {
  readonly limit: number;
  readonly cursor: string | null;
  readonly issuerId: string | null;
  readonly statuses: readonly AnalysisRunStatus[];
  readonly lifecycle: AnalysisRunLifecycle | null;
}

export function parseRunQuery(value: RunQuery | undefined): ParsedRunQuery {
  if (value === undefined) {
    return Object.freeze({ limit: 50, cursor: null, issuerId: null, statuses: [], lifecycle: null });
  }
  const query = record(value, "query");
  exactKeys(query, ["limit", "cursor", "issuerId", "statuses", "lifecycle"], "query");
  const limit = query.limit === undefined ? 50 : nonNegativeInteger(query.limit, "query.limit");
  if (limit < 1 || limit > MAX_RUN_PAGE_SIZE) {
    fail("query.limit", "INVALID_PAGE_SIZE", `must be between 1 and ${MAX_RUN_PAGE_SIZE}`);
  }
  const cursor = query.cursor == null
    ? null
    : boundedString(query.cursor, "query.cursor", { maximum: 2_048 });
  const issuerId = query.issuerId == null
    ? null
    : parsePlatformIdentifier(query.issuerId, "query.issuerId");
  let statuses: readonly AnalysisRunStatus[] = [];
  if (query.statuses !== undefined) {
    if (!Array.isArray(query.statuses)) fail("query.statuses", "INVALID_TYPE", "must be an array");
    statuses = query.statuses.map((status, index) => oneOf(status, ANALYSIS_STATUSES, `query.statuses[${index}]`));
    if (new Set(statuses).size !== statuses.length) {
      fail("query.statuses", "DUPLICATE_FILTER", "must not contain duplicate statuses");
    }
  }
  const lifecycle = query.lifecycle == null
    ? null
    : oneOf(query.lifecycle, ["open", "finalized"] as const, "query.lifecycle");
  return Object.freeze({ limit, cursor, issuerId, statuses: Object.freeze([...statuses]), lifecycle });
}
