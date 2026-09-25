import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

import handler, { resolveExpectedVersion } from "./index.js";

function storedJson(value) {
  return { statusCode: 200, stream: new Response(JSON.stringify(value)).body };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function post(body) {
  return {
    method: "POST",
    headers: { "x-audit-token": "admin" },
    body,
    socket: { remoteAddress: `10.1.0.${Math.floor(Math.random() * 250)}` },
  };
}

const registryBody = (extra = {}) => ({
  kind: "comparison-registry",
  comparisonRegistry: { companies: { TCS: { id: "TCS" } } },
  ...extra,
});

describe("comparison registry writes honour the client's expected version", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    process.env.AUDIT_ADMIN_TOKEN = "admin";
    blob.get.mockReset();
    blob.put.mockReset();
    blob.put.mockResolvedValue({});
  });
  afterEach(() => { process.env = { ...saved }; });

  it("refuses a write based on a version another writer has already replaced", async () => {
    blob.get.mockImplementation(async () => storedJson({ companies: { HDFC: { id: "HDFC" } }, version: 3 }));
    const response = mockResponse();
    await handler(post(registryBody({ expectedVersion: 2 })), response);
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ expectedVersion: 2, actualVersion: 3 });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("accepts a write from the current version and returns the next one", async () => {
    blob.get.mockImplementation(async () => storedJson({ companies: {}, version: 3 }));
    const response = mockResponse();
    await handler(post(registryBody({ expectedVersion: 3 })), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, version: 4 });
  });

  it("keeps last-writer-wins for clients that send no version", async () => {
    blob.get.mockImplementation(async () => storedJson({ companies: {}, version: 7 }));
    const response = mockResponse();
    await handler(post(registryBody()), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ version: 8 });
  });

  it("only trusts a non-negative integer as an expected version", () => {
    expect(resolveExpectedVersion({ expectedVersion: 0 })).toBe(0);
    expect(resolveExpectedVersion({ expectedVersion: 4 })).toBe(4);
    for (const value of [undefined, null, -1, 1.5, "3"]) {
      expect(resolveExpectedVersion({ expectedVersion: value })).toBeNull();
    }
  });
});

describe("listJsonBlobs keeps the newest records, not the first pathnames", () => {
  it("pages through the listing and returns the newest by upload time", async () => {
    const { listJsonBlobs } = await import("./_store.js");
    const at = (day) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
    // Pathname order ≠ time order: the newest record sorts LAST by path.
    blob.list
      .mockResolvedValueOnce({ blobs: [{ pathname: "p/a.json", uploadedAt: at(1) }, { pathname: "p/b.json", uploadedAt: at(2) }], hasMore: true, cursor: "c1" })
      .mockResolvedValueOnce({ blobs: [{ pathname: "p/z.json", uploadedAt: at(20) }], hasMore: false });
    blob.get.mockImplementation(async (pathname) => storedJson({ pathname }));

    const items = await listJsonBlobs("p", 2);

    expect(blob.list).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.pathname)).toEqual(["p/z.json", "p/b.json"]);
  });
});
