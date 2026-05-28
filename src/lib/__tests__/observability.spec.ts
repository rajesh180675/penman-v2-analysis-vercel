/* ================================================================
   Plan 9 PR-9.1 — Observability contract tests.

   Note: tokens used as test inputs below are intentional fakes
   composed at runtime so they don't trip secret scanners.
================================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import {
  scrubPII,
  configureObservability,
  setRunContext,
  getRunContext,
  captureError,
  captureMessage,
  _drainBuffer,
  isEnabled,
} from "../observability";

// Fakes built at runtime so the literal never appears in source
const FAKE_STRIPE = ["sk", "live", "FAKETESTONLYxyz1234567890"].join("_");
const FAKE_GH_PAT = ["ghp", "FAKETESTONLYabc1234567890qrstuv"].join("_");
const FAKE_BEARER = "Bearer fake.fake.token";
const FAKE_HEX = "a".repeat(32);

beforeEach(() => {
  _drainBuffer();
  configureObservability({ enabled: false });
  setRunContext({});
});

describe("scrubPII (Plan 9 PR-9.1)", () => {
  it("Redacts email addresses", () => {
    expect(scrubPII("Contact alice@example.com for help")).toBe(
      "Contact [REDACTED-EMAIL] for help",
    );
  });

  it("Redacts Bearer tokens", () => {
    expect(scrubPII("Authorization: " + FAKE_BEARER)).toMatch(/Bearer \[REDACTED\]/);
  });

  it("Redacts API keys (Stripe, GitHub PAT)", () => {
    expect(scrubPII("key=" + FAKE_STRIPE)).toMatch(/\[REDACTED-TOKEN\]/);
    expect(scrubPII("token=" + FAKE_GH_PAT)).toMatch(/\[REDACTED-TOKEN\]/);
  });

  it("Redacts long hex blobs (hashes / fingerprints)", () => {
    expect(scrubPII("hash=" + FAKE_HEX)).toMatch(/\[REDACTED-HASH\]/);
  });

  it("Preserves financial numbers", () => {
    const out = scrubPII({ ke: 0.13, intrinsicValue: 1234567.89 });
    expect(out).toEqual({ ke: 0.13, intrinsicValue: 1234567.89 });
  });

  it("Redacts sensitive keys regardless of value", () => {
    const out = scrubPII({
      runId: "r-001",
      password: "anyValue",
      apikey: "anyValue",
      KV_REST_API_TOKEN: "anyValue",
    });
    expect((out as any).runId).toBe("r-001");
    expect((out as any).password).toBe("[REDACTED]");
    expect((out as any).apikey).toBe("[REDACTED]");
    expect((out as any).KV_REST_API_TOKEN).toBe("[REDACTED]");
  });

  it("Recurses into nested objects and arrays", () => {
    const out = scrubPII({
      nested: { email: "alice@example.com", v: 1 },
      list: ["plain", "alice@example.com"],
    });
    expect((out as any).nested.email).toBe("[REDACTED-EMAIL]");
    expect((out as any).list[1]).toBe("[REDACTED-EMAIL]");
    expect((out as any).list[0]).toBe("plain");
  });
});

describe("configureObservability + run context (Plan 9 PR-9.1)", () => {
  it("Enabled is false by default (no DSN)", () => {
    expect(isEnabled()).toBe(false);
  });

  it("Enabled is true once DSN is configured", () => {
    configureObservability({ dsn: "https://example.ingest.sentry.io/123", environment: "preview" });
    expect(isEnabled()).toBe(true);
  });

  it("setRunContext / getRunContext roundtrip", () => {
    setRunContext({ runId: "r-001", companyTicker: "RELIANCE", rigorLevel: "valuation-eligible" });
    expect(getRunContext()).toEqual({
      runId: "r-001",
      companyTicker: "RELIANCE",
      rigorLevel: "valuation-eligible",
    });
  });
});

describe("captureError + captureMessage (Plan 9 PR-9.1)", () => {
  it("captureError buffers an event with current run context", () => {
    setRunContext({ runId: "r-001" });
    captureError(new Error("boom"), { detail: "extra" });
    const events = _drainBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe("error");
    expect(events[0]?.message).toBe("boom");
    expect(events[0]?.context.runId).toBe("r-001");
    expect(events[0]?.scrubbed).toEqual({ detail: "extra" });
  });

  it("captureError scrubs PII from extra payload", () => {
    captureError(new Error("auth fail"), {
      authorization: FAKE_BEARER,
      message: "user alice@example.com locked out",
    });
    const events = _drainBuffer();
    expect(events[0]?.scrubbed.authorization).toBe("[REDACTED]");
    expect(String(events[0]?.scrubbed.message)).toContain("[REDACTED-EMAIL]");
  });

  it("captureMessage stores info-level events", () => {
    captureMessage("Run completed", "info");
    captureMessage("Slow parser", "warning");
    const events = _drainBuffer();
    expect(events).toHaveLength(2);
    expect(events[0]?.level).toBe("info");
    expect(events[1]?.level).toBe("warning");
  });
});
