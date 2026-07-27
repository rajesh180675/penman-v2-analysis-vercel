/** @vitest-environment jsdom (audit transport reads window/browser storage) */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuditRecoveryState,
  persistAuditBlob,
  persistAuditEvent,
  rememberAuditRun,
} from "../audit";

const RUN_TOKEN = "run-capability-token-with-at-least-32-characters";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("audit run-scoped writes", () => {
  it("reuses the remembered run capability for later events", async () => {
    rememberAuditRun({
      runId: "run-1",
      companyId: "company-1",
      sourceMode: "json",
      runAccessToken: RUN_TOKEN,
      contentClass: "confidential-financial-statements",
      retentionDays: 45,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await persistAuditEvent({
      runId: "run-1",
      eventType: "valuation-computed",
      payload: { value: 42 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body));
    expect(headers["x-audit-run-token"]).toBe(RUN_TOKEN);
    expect(headers["x-audit-token"]).toBeUndefined();
    expect(body.runAccessToken).toBe(RUN_TOKEN);
  });

  it("does not retry or queue a permanently rejected 413 event", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: "Payload too large" }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    ));

    await persistAuditEvent({
      runId: "run-413",
      eventType: "analysis-snapshot",
      payload: { value: 42 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getAuditRecoveryState().pendingEvents).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      "[audit] permanently rejected event was not queued",
      expect.objectContaining({ status: 413, retryable: false }),
    );
  });

  it("rejects an oversized event client-side without a request or queue entry", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await persistAuditEvent({
      runId: "run-preflight",
      eventType: "analysis-snapshot",
      payload: { oversized: "x".repeat(8 * 1024 * 1024) },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAuditRecoveryState().pendingEvents).toEqual([]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("exceeds the"));
  });

  it("uses the local binary endpoint for audit artifacts in development", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ ok: true, path: "audit/artifacts/run-blob/snapshot.json.gz", size: 4 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const result = await persistAuditBlob({
      runId: "run-blob",
      kind: "artifacts",
      eventType: "analysis-snapshot-artifact",
      file: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/gzip" }),
      filename: "snapshot.json.gz",
      contentType: "application/gzip",
      contentEncoding: "gzip",
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, size: 4 }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("/api/audit/blobs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(Blob);
    expect(init?.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/octet-stream",
      "x-audit-kind": "artifacts",
      "x-audit-content-type": "application/gzip",
      "x-audit-content-encoding": "gzip",
    }));
  });
});
