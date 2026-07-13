import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);

import { authorizeAuditRunRead, authorizeAuditRunWrite } from "./_runAccess.js";

const TOKEN = "first-run-capability-token-with-32-plus-characters";

function request(headers = {}) {
  return { headers, query: {}, socket: { remoteAddress: "127.0.0.1" } };
}

beforeEach(() => {
  blob.get.mockReset();
  blob.put.mockReset();
  process.env.VERCEL = "1";
  delete process.env.AUDIT_ADMIN_TOKEN;
  delete process.env.AUDIT_ADMIN_WRITE_TOKEN;
  delete process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
});

afterEach(() => {
  delete process.env.VERCEL;
  delete process.env.AUDIT_ADMIN_TOKEN;
  delete process.env.AUDIT_ADMIN_WRITE_TOKEN;
  delete process.env.AUDIT_ADMIN_TOKEN_PREVIOUS;
});

describe("audit run capability", () => {
  it("establishes an immutable hash manifest on the first write", async () => {
    blob.get.mockResolvedValue(null);
    blob.put.mockResolvedValue({ pathname: "audit-runs/run-1/access/manifest.json" });

    const result = await authorizeAuditRunWrite(request(), {
      runId: "run-1",
      runAccessToken: TOKEN,
    });

    expect(result.authorized).toBe(true);
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [, raw] = blob.put.mock.calls[0];
    const manifest = JSON.parse(raw);
    expect(manifest.runAccessHash).toMatch(/^[a-f0-9]{64}$/);
    expect(raw).not.toContain(TOKEN);
  });

  it("rejects a different capability after the run is established", async () => {
    blob.get.mockResolvedValue(null);
    blob.put.mockResolvedValue({});
    await authorizeAuditRunWrite(request(), { runId: "run-1", runAccessToken: TOKEN });

    const manifest = JSON.parse(blob.put.mock.calls[0][1]);
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: JSON.stringify(manifest),
    });

    const result = await authorizeAuditRunWrite(request(), {
      runId: "run-1",
      runAccessToken: "a-different-capability-token-with-32-characters",
    });
    expect(result.authorized).toBe(false);
    expect(blob.put).toHaveBeenCalledTimes(1);
  });

  it("allows the configured server-side write administrator", async () => {
    process.env.AUDIT_ADMIN_WRITE_TOKEN = "server-secret";
    const result = await authorizeAuditRunWrite(
      request({ "x-audit-token": "server-secret" }),
      { runId: "run-1" },
    );
    expect(result).toEqual({ authorized: true, mode: "admin" });
    expect(blob.get).not.toHaveBeenCalled();
  });

  it("authorizes reads only when the presented capability matches the manifest", async () => {
    blob.get.mockResolvedValue(null);
    blob.put.mockResolvedValue({});
    await authorizeAuditRunWrite(request(), { runId: "run-1", runAccessToken: TOKEN });
    const manifest = JSON.parse(blob.put.mock.calls[0][1]);
    blob.get.mockResolvedValue({ statusCode: 200, stream: JSON.stringify(manifest) });

    await expect(authorizeAuditRunRead(
      request({ "x-audit-run-token": TOKEN }),
      { runId: "run-1" },
    )).resolves.toEqual({ authorized: true, mode: "run-capability" });
    await expect(authorizeAuditRunRead(
      request({ "x-audit-run-token": "a-different-capability-token-with-32-characters" }),
      { runId: "run-1" },
    )).resolves.toEqual({ authorized: false, mode: "run-capability" });
  });
});
