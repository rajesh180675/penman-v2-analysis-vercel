import { upload } from "@vercel/blob/client";

export interface AuditSubmissionMeta {
  runId: string;
  sourceMode: "capitaline" | "screener" | "json" | "xbrl" | "manual" | "sample";
  companyId: string;
  fileName?: string | null;
  runAccessToken: string;
  contentClass: string;
  retentionDays: number;
}

interface AuditEventInput {
  runId: string;
  eventType: string;
  companyId?: string | null;
  sourceMode?: string | null;
  payload: unknown;
  idempotencyKey?: string;
  runAccessToken?: string | null;
  contentClass?: string | null;
  retentionDays?: number | null;
}

interface AuditBlobInput {
  runId: string;
  kind: "inputs" | "artifacts";
  eventType: string;
  file: Blob;
  filename: string;
  companyId?: string | null;
  sourceMode?: string | null;
  contentType?: string;
  idempotencyKey?: string;
  runAccessToken?: string | null;
  maximumSizeInBytes?: number;
  allowedContentTypes?: string[];
  contentClass?: string | null;
  retentionDays?: number | null;
}

const AUDIT_ENABLED =
  (import.meta.env.VITE_AUDIT_CAPTURE_ENABLED ?? "true").toLowerCase() !== "false";
const AUDIT_CONTENT_CLASS =
  (import.meta.env.VITE_AUDIT_CONTENT_CLASS ?? "confidential-financial-statements").trim();
const AUDIT_RETENTION_DAYS = clampNumber(import.meta.env.VITE_AUDIT_RETENTION_DAYS, 45, 7, 365);
const AUDIT_MAX_UPLOAD_BYTES = clampNumber(import.meta.env.VITE_AUDIT_MAX_UPLOAD_BYTES, 64 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024);
const AUDIT_PENDING_EVENTS_KEY = "penman.audit.pending-events.v1";
const AUDIT_PENDING_FAILURES_KEY = "penman.audit.pending-failures.v1";
const AUDIT_RECENT_RUNS_KEY = "penman.audit.recent-runs.v1";
const AUDIT_RETRY_ATTEMPTS = 3;

type StoredPendingEvent = AuditEventInput & { queuedAt: string };
type StoredAuditFailure = {
  kind: "inputs" | "artifacts";
  runId: string;
  filename: string;
  eventType: string;
  queuedAt: string;
  message: string;
};
type StoredAuditRun = {
  runId: string;
  companyId: string;
  sourceMode: AuditSubmissionMeta["sourceMode"];
  fileName: string | null;
  runAccessToken: string | null;
  contentClass: string;
  retentionDays: number;
  createdAt: string;
  lastSeenAt: string;
};

function clampNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredArray<T>(key: string): T[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeStoredArray<T>(key: string, value: T[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors; audit should not block analysis UX.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomTokenSegment() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2).padEnd(32, "0");
}

function createIdempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${randomTokenSegment().slice(0, 12)}`;
}

function getStoredRun(runId: string) {
  return readStoredArray<StoredAuditRun>(AUDIT_RECENT_RUNS_KEY).find((item) => item.runId === runId) ?? null;
}

function rememberFailure(entry: StoredAuditFailure) {
  const failures = readStoredArray<StoredAuditFailure>(AUDIT_PENDING_FAILURES_KEY)
    .filter((item) => !(item.runId === entry.runId && item.filename === entry.filename && item.kind === entry.kind));
  failures.unshift(entry);
  writeStoredArray(AUDIT_PENDING_FAILURES_KEY, failures.slice(0, 25));
}

function clearFailure(runId: string, filename: string, kind: "inputs" | "artifacts") {
  const failures = readStoredArray<StoredAuditFailure>(AUDIT_PENDING_FAILURES_KEY)
    .filter((item) => !(item.runId === runId && item.filename === filename && item.kind === kind));
  writeStoredArray(AUDIT_PENDING_FAILURES_KEY, failures);
}

async function withRetry<T>(task: () => Promise<T>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < AUDIT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < AUDIT_RETRY_ATTEMPTS - 1 && typeof window !== "undefined") {
        await sleep(250 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function postAuditEventRequest(body: AuditEventInput) {
  return withRetry(async () => {
    const response = await fetch("/api/audit/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Audit event failed with ${response.status}`);
    }

    return await response.json();
  });
}

export function createAuditRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAuditEnabled() {
  return AUDIT_ENABLED;
}

export function createAuditAccessToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${randomTokenSegment().slice(0, 16)}`;
  }
  return `audit-${Date.now()}-${randomTokenSegment()}`;
}

export function getAuditClientGovernance() {
  return {
    contentClass: AUDIT_CONTENT_CLASS,
    retentionDays: AUDIT_RETENTION_DAYS,
    maximumUploadBytes: AUDIT_MAX_UPLOAD_BYTES,
  };
}

export function rememberAuditRun(meta: AuditSubmissionMeta) {
  const existing = readStoredArray<StoredAuditRun>(AUDIT_RECENT_RUNS_KEY)
    .filter((item) => item.runId !== meta.runId);
  existing.unshift({
    runId: meta.runId,
    companyId: meta.companyId,
    sourceMode: meta.sourceMode,
    fileName: meta.fileName ?? null,
    runAccessToken: null,
    contentClass: meta.contentClass,
    retentionDays: meta.retentionDays,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
  writeStoredArray(AUDIT_RECENT_RUNS_KEY, existing.slice(0, 12));
}

export function listRememberedAuditRuns() {
  return readStoredArray<StoredAuditRun>(AUDIT_RECENT_RUNS_KEY);
}

export function getAuditRecoveryState() {
  return {
    pendingEvents: readStoredArray<StoredPendingEvent>(AUDIT_PENDING_EVENTS_KEY),
    pendingFailures: readStoredArray<StoredAuditFailure>(AUDIT_PENDING_FAILURES_KEY),
  };
}

export async function flushQueuedAuditEvents() {
  if (!AUDIT_ENABLED || !canUseStorage()) return;
  const pending = readStoredArray<StoredPendingEvent>(AUDIT_PENDING_EVENTS_KEY);
  if (!pending.length) return;

  const remaining: StoredPendingEvent[] = [];
  for (const entry of pending) {
    try {
      await postAuditEventRequest(entry);
    } catch {
      remaining.push(entry);
    }
  }

  writeStoredArray(AUDIT_PENDING_EVENTS_KEY, remaining);
}

export async function persistAuditEvent(input: AuditEventInput) {
  if (!AUDIT_ENABLED) return null;

  const storedRun = getStoredRun(input.runId);
  const payload: AuditEventInput = {
    ...input,
    idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(`${input.runId}-${input.eventType}`),
    runAccessToken: input.runAccessToken ?? null,
    contentClass: input.contentClass ?? storedRun?.contentClass ?? AUDIT_CONTENT_CLASS,
    retentionDays: input.retentionDays ?? storedRun?.retentionDays ?? AUDIT_RETENTION_DAYS,
  };

  try {
    await flushQueuedAuditEvents();
    return await postAuditEventRequest(payload);
  } catch (error) {
    const pending = readStoredArray<StoredPendingEvent>(AUDIT_PENDING_EVENTS_KEY);
    pending.push({
      ...payload,
      queuedAt: new Date().toISOString(),
    });
    writeStoredArray(AUDIT_PENDING_EVENTS_KEY, pending.slice(-50));
    console.warn("[audit] event persistence skipped", error);
    return null;
  }
}

export async function persistAuditBlob(input: AuditBlobInput) {
  if (!AUDIT_ENABLED) return null;

  const storedRun = getStoredRun(input.runId);
  const runAccessToken = input.runAccessToken ?? storedRun?.runAccessToken ?? null;
  const contentClass = input.contentClass ?? storedRun?.contentClass ?? AUDIT_CONTENT_CLASS;
  const retentionDays = input.retentionDays ?? storedRun?.retentionDays ?? AUDIT_RETENTION_DAYS;
  const maximumSizeInBytes = Math.min(
    input.maximumSizeInBytes ?? AUDIT_MAX_UPLOAD_BYTES,
    AUDIT_MAX_UPLOAD_BYTES,
  );

  if (input.file.size > maximumSizeInBytes) {
    const message = `Audit blob skipped because ${input.filename} exceeds ${maximumSizeInBytes} bytes.`;
    rememberFailure({
      kind: input.kind,
      runId: input.runId,
      filename: input.filename,
      eventType: input.eventType,
      queuedAt: new Date().toISOString(),
      message,
    });
    console.warn("[audit] blob persistence skipped", message);
    return null;
  }

  try {
    const pathname = `audit-runs/${input.runId}/${input.kind}/${input.filename}`;

    const result = await withRetry(() =>
      upload(pathname, input.file, {
        access: "private",
        contentType: input.contentType || input.file.type || "application/octet-stream",
        handleUploadUrl: "/api/audit/uploads",
        clientPayload: JSON.stringify({
          runId: input.runId,
          kind: input.kind,
          eventType: input.eventType,
          companyId: input.companyId ?? null,
          sourceMode: input.sourceMode ?? null,
          filename: input.filename,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(`${input.runId}-${input.kind}`),
          runAccessToken,
          contentClass,
          retentionDays,
          maximumSizeInBytes,
          allowedContentTypes: input.allowedContentTypes ?? null,
        }),
      })
    );
    clearFailure(input.runId, input.filename, input.kind);
    return result;
  } catch (error) {
    rememberFailure({
      kind: input.kind,
      runId: input.runId,
      filename: input.filename,
      eventType: input.eventType,
      queuedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
    console.warn("[audit] blob persistence skipped", error);
    return null;
  }
}

export async function persistAuditFile(input: Omit<AuditBlobInput, "file"> & { file: File }) {
  return persistAuditBlob(input);
}
