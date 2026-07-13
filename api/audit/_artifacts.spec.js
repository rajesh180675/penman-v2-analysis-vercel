import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

import handler from "./artifacts.js";

const TOKEN = "production-artifact-token-with-more-than-32-characters";
const RUN_ID = "run-production";
const PATHNAME = `audit-runs/${RUN_ID}/artifacts/analysis-snapshot-abc.json.gz`;
const EVENT_PATH = `audit-runs/${RUN_ID}/events/event.json`;
const snapshot = { schemaVersion: "analysis-snapshot-v1", companyId: "TCS", family: "industrial", periodCount: 15, latestPeriod: "2026-03-31" };
const decoded = Buffer.from(JSON.stringify(snapshot));
const stored = gzipSync(decoded);
const hash = crypto.createHash("sha256").update(decoded).digest("hex");

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function request(query = {}, token = TOKEN) {
  return { method: "GET", query, headers: token ? { "x-audit-run-token": token } : {} };
}

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "configured";
  blob.get.mockReset();
  blob.list.mockReset();
  blob.get.mockImplementation(async (pathname) => {
    if (pathname.endsWith("/access/manifest.json")) {
      return { statusCode: 200, stream: JSON.stringify({ runAccessHash: crypto.createHash("sha256").update(TOKEN).digest("hex") }) };
    }
    if (pathname === PATHNAME) {
      return { statusCode: 200, stream: stored, blob: { contentType: "application/gzip", uploadedAt: "2026-07-12T00:00:00.000Z" } };
    }
    if (pathname === EVENT_PATH) {
      return { statusCode: 200, stream: JSON.stringify({ eventType: "analysis-snapshot", payload: { artifact: {
        pathname: PATHNAME,
        filename: "analysis-snapshot-abc.json.gz",
        contentType: "application/gzip",
        contentEncoding: "gzip",
        contentHash: hash,
        contentHashAlgorithm: "sha256",
      } } }) };
    }
    return null;
  });
  blob.list.mockResolvedValue({ blobs: [{ pathname: EVENT_PATH, uploadedAt: "2026-07-12T00:00:01.000Z" }], hasMore: false });
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("production audit artifact handler", () => {
  it("authorizes, decompresses, hashes, and summarizes a private artifact", async () => {
    const response = responseHarness();
    await handler(request({ runId: RUN_ID, pathname: PATHNAME }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.verification).toEqual(expect.objectContaining({ status: "verified", actualHash: hash, decodedBytes: decoded.byteLength, parsed: true }));
    expect(response.body.snapshotSummary).toEqual(expect.objectContaining({ companyId: "TCS", periodCount: 15 }));
  });

  it("streams the original stored bytes for an authorized download", async () => {
    const response = responseHarness();
    await handler(request({ runId: RUN_ID, pathname: PATHNAME, download: "1" }), response);
    expect(response.statusCode).toBe(200);
    expect(Buffer.compare(response.body, stored)).toBe(0);
    expect(response.headers["content-disposition"]).toContain("analysis-snapshot-abc.json.gz");
  });

  it("rejects an invalid run capability before reading the artifact", async () => {
    const response = responseHarness();
    await handler(request({ runId: RUN_ID, pathname: PATHNAME }, "wrong-token-with-more-than-thirty-two-characters"), response);
    expect(response.statusCode).toBe(401);
    expect(blob.get).toHaveBeenCalledTimes(1);
  });
});
