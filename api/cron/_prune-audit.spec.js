import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ del: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

import handler, { classifyAuditPruneCandidate } from "./_prune-audit.js";

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "configured";
  process.env.CRON_SECRET = "cron-secret";
  blob.del.mockReset().mockResolvedValue(undefined);
  blob.get.mockReset();
  blob.list.mockReset();
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("deployed audit retention classification", () => {
  const now = new Date("2026-07-12T00:00:00.000Z").getTime();

  it("classifies expired and orphaned artifacts independently", () => {
    expect(classifyAuditPruneCandidate({
      blob: { pathname: "audit-runs/run/events/event.json", uploadedAt: "2026-05-01T00:00:00.000Z" },
      now,
      retentionDays: 45,
      hasEvents: true,
    })).toBe("expired");
    expect(classifyAuditPruneCandidate({
      blob: { pathname: "audit-runs/orphan/artifacts/snapshot.json.gz", uploadedAt: "2026-07-01T00:00:00.000Z" },
      now,
      retentionDays: 45,
      hasEvents: false,
    })).toBe("orphan");
    expect(classifyAuditPruneCandidate({
      blob: { pathname: "audit-runs/new/artifacts/snapshot.json.gz", uploadedAt: "2026-07-12T00:00:00.000Z" },
      now,
      retentionDays: 45,
      hasEvents: false,
    })).toBeNull();
  });

  it("deletes expired run blobs and eventless orphan artifacts end to end", async () => {
    const expiredEvent = { pathname: "audit-runs/expired/events/event.json", uploadedAt: "2020-01-01T00:00:00.000Z", url: "https://blob/expired-event", size: 10 };
    const expiredArtifact = { pathname: "audit-runs/expired/artifacts/snapshot.json.gz", uploadedAt: "2020-01-01T00:00:00.000Z", url: "https://blob/expired-artifact", size: 20 };
    const orphanArtifact = { pathname: "audit-runs/orphan/artifacts/snapshot.json.gz", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString(), url: "https://blob/orphan", size: 30 };
    blob.list.mockImplementation(async ({ prefix }) => ({
      blobs: prefix === "audit-runs/" ? [expiredEvent, expiredArtifact, orphanArtifact] : [],
      hasMore: false,
      cursor: undefined,
    }));
    blob.get.mockResolvedValue({ statusCode: 200, stream: JSON.stringify({ retentionDays: 30 }) });
    const response = responseHarness();
    await handler({ method: "GET", headers: { authorization: "Bearer cron-secret" } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body.deletedCount).toBe(3);
    expect(response.body.deleted.map((item) => item.reason)).toEqual(expect.arrayContaining(["expired", "orphan"]));
    expect(blob.del).toHaveBeenCalled();
  });
});
