import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: vi.fn(), put: vi.fn(), list: vi.fn(), del: vi.fn() }));

import { resolveUploadTarget } from "./uploads.js";
import {
  requireAuditWriteAuth,
  resolveRetentionDays,
} from "./_lib.js";

const GOVERNANCE = { maxUploadBytes: 64 * 1024 * 1024, retentionDays: 45 };

function payload(overrides = {}) {
  return { runId: "run-abc", kind: "artifacts", filename: "snap.json.gz", ...overrides };
}

describe("resolveUploadTarget — the token is minted for exactly one run path", () => {
  it("accepts the canonical pathname for the authorized run", () => {
    const target = resolveUploadTarget("audit-runs/run-abc/artifacts/snap.json.gz", payload(), GOVERNANCE);
    expect(target.pathname).toBe("audit-runs/run-abc/artifacts/snap.json.gz");
    expect(target.runId).toBe("run-abc");
  });

  it("refuses a pathname outside the authorized run's prefix", () => {
    for (const pathname of [
      "research-store/companies/TCS/valuations/planted.json",
      "audit-runs/victim-run/events/forged.json",
      "audit-runs/run-abc/access/manifest.json",
      "audit-runs/run-abc/artifacts/other.json",
    ]) {
      expect(() => resolveUploadTarget(pathname, payload(), GOVERNANCE)).toThrow(/pathname must be/);
    }
  });

  it("requires an explicit run id instead of minting a fresh one", () => {
    expect(() => resolveUploadTarget("audit-runs/x/artifacts/snap.json.gz", payload({ runId: undefined }), GOVERNANCE))
      .toThrow(/runId is required/);
  });

  it("only allows the inputs and artifacts kinds", () => {
    expect(() => resolveUploadTarget("audit-runs/run-abc/events/e.json", payload({ kind: "events", filename: "e.json" }), GOVERNANCE))
      .toThrow(/kind must be/);
  });

  it("lets the client narrow the content types but never widen them", () => {
    const narrowed = resolveUploadTarget(
      "audit-runs/run-abc/artifacts/snap.json.gz",
      payload({ allowedContentTypes: ["application/json", "text/html"] }),
      GOVERNANCE,
    );
    expect(narrowed.allowedContentTypes).toEqual(["application/json"]);
    expect(() => resolveUploadTarget(
      "audit-runs/run-abc/artifacts/snap.json.gz",
      payload({ allowedContentTypes: ["text/html"] }),
      GOVERNANCE,
    )).toThrow(/content types/);
  });

  it("clamps size and retention to governance", () => {
    const target = resolveUploadTarget(
      "audit-runs/run-abc/artifacts/snap.json.gz",
      payload({ maximumSizeInBytes: 10 * GOVERNANCE.maxUploadBytes, retentionDays: 100000 }),
      GOVERNANCE,
    );
    expect(target.maximumSizeInBytes).toBe(GOVERNANCE.maxUploadBytes);
    expect(target.retentionDays).toBe(45);
  });
});

describe("resolveRetentionDays", () => {
  it("may shorten the governed window but never extend it", () => {
    expect(resolveRetentionDays(7, 45)).toBe(7);
    expect(resolveRetentionDays(1e9, 45)).toBe(45);
    expect(resolveRetentionDays("0.2", 45)).toBe(1);
  });

  it("falls back to governance for absent or invalid values", () => {
    for (const value of [undefined, null, 0, -3, "abc", Number.NaN]) {
      expect(resolveRetentionDays(value, 45)).toBe(45);
    }
  });
});

describe("requireAuditWriteAuth — rotation grace token scoping", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  function call(token) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    const ok = requireAuditWriteAuth({ headers: { "x-audit-token": token } }, response);
    return { ok, status: response.statusCode };
  }

  it("does not let the read-side previous token write when a distinct write token exists", () => {
    process.env.AUDIT_ADMIN_TOKEN = "read-current";
    process.env.AUDIT_ADMIN_TOKEN_PREVIOUS = "read-previous";
    process.env.AUDIT_ADMIN_WRITE_TOKEN = "write-current";
    expect(call("write-current").ok).toBe(true);
    expect(call("read-previous")).toEqual({ ok: false, status: 401 });
  });

  it("keeps single-token rotation working", () => {
    delete process.env.AUDIT_ADMIN_WRITE_TOKEN;
    process.env.AUDIT_ADMIN_TOKEN = "current";
    process.env.AUDIT_ADMIN_TOKEN_PREVIOUS = "previous";
    expect(call("previous").ok).toBe(true);
  });
});
