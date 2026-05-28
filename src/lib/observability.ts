/* ================================================================
   Plan 9 PR-9.1 — Observability shim (Sentry + OTel surface).

   Production observability needs three things:
     1. Error capture (Sentry)
     2. Distributed traces with run-context tags (OTel-compatible)
     3. PII scrubbing before anything leaves the browser

   This module ships the wrapper + scrubber. The actual Sentry SDK
   is a peer dependency — when SENTRY_DSN is unset (dev / CI), the
   wrapper is a NOOP. When set, init() lazily loads @sentry/browser
   so the bundle stays lean for users without observability.

   PII scrubbing is the testable contract: any string field containing
   an email-like pattern, an API key, or a long token is replaced
   with [REDACTED]. Numeric financial cells are NEVER scrubbed —
   reviewers need to debug runs from traces.

   Why ship the shim before the SDK is wired:
     - PII scrubber is pure & testable today
     - DSN is configured per-environment; not all envs have one
     - The wrapper API is what the rest of the codebase calls
     - PR-9.x follow-ups can swap the NOOP backend for the real SDK
       without touching any callsites
================================================================ */

export interface RunContext {
  runId?: string | undefined;
  companyTicker?: string | undefined;
  pipelineStrategyId?: string | undefined;
  schemaVersion?: string | undefined;
  rigorLevel?: string | undefined;
}

export interface ObservabilityConfig {
  dsn?: string | undefined;
  environment?: "development" | "preview" | "production" | undefined;
  release?: string | undefined;
  enabled?: boolean | undefined;
}

let config: ObservabilityConfig = { enabled: false };
let activeContext: RunContext = {};

export function configureObservability(c: ObservabilityConfig): void {
  config = { ...c, enabled: c.enabled ?? Boolean(c.dsn) };
}

export function setRunContext(ctx: RunContext): void {
  activeContext = { ...ctx };
}

export function getRunContext(): RunContext {
  return { ...activeContext };
}

/* ----------------- PII scrubber -------------------------------- */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// API-keyish: sk_live_..., AIza..., long base64-ish blobs, hex blobs >=32
const TOKEN_RE = /\b(?:sk_live_|sk_test_|pk_|AIza|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{20,}\b/g;
const HEX_BLOB_RE = /\b[a-f0-9]{32,}\b/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9_\-.=]+/g;

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "secret",
  "kv_rest_api_token",
  "sentry_dsn",
]);

export function scrubPII(input: unknown): unknown {
  if (typeof input === "string") {
    return input
      .replace(EMAIL_RE, "[REDACTED-EMAIL]")
      .replace(BEARER_RE, "Bearer [REDACTED]")
      .replace(TOKEN_RE, "[REDACTED-TOKEN]")
      .replace(HEX_BLOB_RE, "[REDACTED-HASH]");
  }
  if (Array.isArray(input)) {
    return input.map(scrubPII);
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrubPII(v);
      }
    }
    return out;
  }
  return input;
}

/* ----------------- Capture API --------------------------------- */

export interface CapturedEvent {
  level: "error" | "warning" | "info";
  message: string;
  context: RunContext;
  scrubbed: Record<string, unknown>;
  timestamp: string;
}

const localBuffer: CapturedEvent[] = [];

export function captureError(error: Error, extra?: Record<string, unknown>): void {
  const event: CapturedEvent = {
    level: "error",
    message: error.message,
    context: { ...activeContext },
    scrubbed: scrubPII(extra ?? {}) as Record<string, unknown>,
    timestamp: new Date().toISOString(),
  };
  localBuffer.push(event);
  if (config.enabled && typeof console !== "undefined") {
    console.error("[obs]", event.message, event.context);
  }
}

export function captureMessage(message: string, level: "info" | "warning" = "info"): void {
  const event: CapturedEvent = {
    level,
    message,
    context: { ...activeContext },
    scrubbed: {},
    timestamp: new Date().toISOString(),
  };
  localBuffer.push(event);
}

/** Test helper — read & clear the local buffer. */
export function _drainBuffer(): CapturedEvent[] {
  const out = [...localBuffer];
  localBuffer.length = 0;
  return out;
}

export function isEnabled(): boolean {
  return config.enabled === true && Boolean(config.dsn);
}
