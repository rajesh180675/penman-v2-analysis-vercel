import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import auditRouter from "./audit";

describe("local audit binary persistence", () => {
  let dataDirectory: string | null = null;

  afterEach(async () => {
    delete process.env.PENMAN_DATA_DIR;
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
    dataDirectory = null;
  });

  it("stores a compressed analysis artifact without JSON body parsing", async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "penman-audit-"));
    process.env.PENMAN_DATA_DIR = dataDirectory;
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/api/audit", auditRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/audit/blobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-audit-run-id": "run-tcs",
          "x-audit-kind": "artifacts",
          "x-audit-filename": "analysis-snapshot.json.gz",
          "x-audit-event-type": "analysis-snapshot-artifact",
          "x-audit-content-type": "application/gzip",
          "x-audit-content-encoding": "gzip",
        },
        body: new Uint8Array([31, 139, 8, 0]),
      });
      const payload = await response.json() as { ok: boolean; path: string; size: number };

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        ok: true,
        path: "audit/artifacts/run-tcs/analysis-snapshot.json.gz",
        size: 4,
      });
      const stored = await readFile(join(dataDirectory, "audit", "artifacts", "run-tcs", "analysis-snapshot.json.gz"));
      expect([...stored]).toEqual([31, 139, 8, 0]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("lists, verifies, and downloads a run-scoped snapshot artifact", async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "penman-audit-"));
    process.env.PENMAN_DATA_DIR = dataDirectory;
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/api/audit", auditRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/audit`;
    const token = "run-token-with-more-than-thirty-two-characters";
    const pathname = "audit/artifacts/run-verified/analysis-snapshot.json.gz";
    const snapshot = Buffer.from(JSON.stringify({ schemaVersion: "snapshot-v1", companyId: "TCS", family: "industrial", periodCount: 15, latestPeriod: "2026-03-31" }));
    const compressed = gzipSync(snapshot);
    const contentHash = createHash("sha256").update(snapshot).digest("hex");

    try {
      const eventResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-audit-run-token": token },
        body: JSON.stringify({
          runId: "run-verified",
          eventType: "analysis-snapshot",
          companyId: "TCS",
          sourceMode: "capitaline",
          runAccessToken: token,
          retentionDays: 45,
          payload: { artifact: { filename: "analysis-snapshot.json.gz", pathname, contentHash, contentHashAlgorithm: "sha256", contentEncoding: "gzip" }, traceability: { confidence: { status: "production-ready" } } },
        }),
      });
      expect(eventResponse.status).toBe(200);
      const uploadResponse = await fetch(`${baseUrl}/blobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-audit-run-id": "run-verified",
          "x-audit-kind": "artifacts",
          "x-audit-filename": "analysis-snapshot.json.gz",
          "x-audit-event-type": "analysis-snapshot-artifact",
          "x-audit-content-type": "application/gzip",
          "x-audit-content-encoding": "gzip",
          "x-audit-run-token": token,
        },
        body: compressed,
      });
      expect(uploadResponse.status).toBe(200);

      const inspectorResponse = await fetch(`${baseUrl}/inspector?runId=run-verified`, { headers: { "x-audit-run-token": token } });
      const inspector = await inspectorResponse.json() as { counts: { events: number; artifacts: number }; artifacts: Array<{ pathname: string }> };
      expect(inspectorResponse.status).toBe(200);
      expect(inspector.counts).toEqual(expect.objectContaining({ events: 1, artifacts: 1 }));
      expect(inspector.artifacts[0]?.pathname).toBe(pathname);

      const verifyResponse = await fetch(`${baseUrl}/artifacts?runId=run-verified&pathname=${encodeURIComponent(pathname)}`, { headers: { "x-audit-run-token": token } });
      const verification = await verifyResponse.json() as { verification: { status: string; actualHash: string }; snapshotSummary: { periodCount: number } };
      expect(verifyResponse.status).toBe(200);
      expect(verification.verification).toEqual(expect.objectContaining({ status: "verified", actualHash: contentHash }));
      expect(verification.snapshotSummary.periodCount).toBe(15);

      const unauthorized = await fetch(`${baseUrl}/artifacts?runId=run-verified&pathname=${encodeURIComponent(pathname)}`, { headers: { "x-audit-run-token": "wrong-token-with-more-than-thirty-two-chars" } });
      expect(unauthorized.status).toBe(401);

      const download = await fetch(`${baseUrl}/artifacts?runId=run-verified&pathname=${encodeURIComponent(pathname)}&download=1`, { headers: { "x-audit-run-token": token } });
      expect(Buffer.from(await download.arrayBuffer())).toEqual(compressed);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
