/**
 * API Integration Tests — Local Express Server
 *
 * Tests the server routes (research, audit, blackboard, health) using
 * Node's native fetch against a real running server instance.
 * Data is isolated in a temp directory, cleaned up after each suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

let server: Server;
let baseUrl: string;
let tmpDataDir: string;

async function startServer(): Promise<{ server: Server; port: number }> {
  // Set a temp data dir so tests don't pollute real data
  tmpDataDir = path.join(os.tmpdir(), `penman-api-test-${Date.now()}`);
  await fs.mkdir(tmpDataDir, { recursive: true });
  process.env.PENMAN_DATA_DIR = tmpDataDir;
  process.env.LOCAL_SERVER_PORT = "0"; // will be overridden

  // Dynamic import to pick up env vars
  const express = (await import("express")).default;
  const cors = (await import("cors")).default;
  const { default: auditRouter } = await import("../../server/routes/audit");
  const { default: researchRouter } = await import("../../server/routes/research");
  const { readJson, writeJson } = await import("../../server/store/fsStore");

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "50mb" }));

  app.use("/api/audit", auditRouter);
  app.use("/api/research", researchRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: "test", timestamp: new Date().toISOString() });
  });

  // Blackboard
  app.get("/api/blackboard", async (req, res) => {
    const session = (req.query.session as string) ?? "default";
    const filePath = path.join(tmpDataDir, "blackboard", `${session}.json`);
    try {
      const data = await readJson(filePath);
      res.json({ ok: true, data: data ?? {} });
    } catch {
      res.json({ ok: true, data: {} });
    }
  });

  app.put("/api/blackboard", async (req, res) => {
    const session = (req.query.session as string) ?? "default";
    const filePath = path.join(tmpDataDir, "blackboard", `${session}.json`);
    await writeJson(filePath, req.body);
    res.json({ ok: true });
  });

  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, port });
    });
  });
}

describe("API Integration Tests", () => {
  beforeAll(async () => {
    const result = await startServer();
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  }, 15000);

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (tmpDataDir) await fs.rm(tmpDataDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("Health", () => {
    it("returns ok", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.mode).toBe("test");
    });
  });

  describe("Audit API", () => {
    const runId = "test-run-001";

    it("POST /api/audit/events — creates an audit event", async () => {
      const res = await fetch(`${baseUrl}/api/audit/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          eventType: "parse_complete",
          companyId: "HDFC_Bank",
          sourceMode: "capitaline",
          payload: { periods: 5 },
        }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.eventId).toBeTruthy();
    });

    it("POST /api/audit/events — rejects missing runId", async () => {
      const res = await fetch(`${baseUrl}/api/audit/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "x" }),
      });
      expect(res.status).toBe(400);
    });

    it("GET /api/audit/events?runId=x — lists events for a run", async () => {
      const res = await fetch(`${baseUrl}/api/audit/events?runId=${runId}`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.events.length).toBeGreaterThanOrEqual(1);
      expect(body.events[0].eventType).toBe("parse_complete");
    });

    it("GET /api/audit/events — rejects missing runId param", async () => {
      const res = await fetch(`${baseUrl}/api/audit/events`);
      expect(res.status).toBe(400);
    });

    it("GET /api/audit/runs — lists all runs", async () => {
      const res = await fetch(`${baseUrl}/api/audit/runs`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.runs.length).toBeGreaterThanOrEqual(1);
      expect(body.runs[0].runId).toBe(runId);
    });

    it("GET /api/audit/runs/:runId — returns a single run", async () => {
      const res = await fetch(`${baseUrl}/api/audit/runs/${runId}`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.run.runId).toBe(runId);
      expect(body.run.eventCount).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/audit/runs/:runId — 404 for unknown run", async () => {
      const res = await fetch(`${baseUrl}/api/audit/runs/nonexistent-run`);
      expect(res.status).toBe(404);
    });

    it("POST /api/audit/uploads — acknowledges upload", async () => {
      const res = await fetch(`${baseUrl}/api/audit/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, filename: "HDFC_Bank.zip", size: 12345 }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("GET /api/audit/monitor — health check", async () => {
      const res = await fetch(`${baseUrl}/api/audit/monitor`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("rejects path traversal in runId", async () => {
      const res = await fetch(`${baseUrl}/api/audit/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: "../../../etc/passwd", eventType: "x" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Research API", () => {
    const companyId = "Asian_Paints";

    it("PUT /api/research/:companyId — creates workspace entry", async () => {
      const res = await fetch(`${baseUrl}/api/research/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: "FMCG", notes: "Testing" }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.companyId).toBe(companyId);
      expect(body.data.sector).toBe("FMCG");
      expect(body.data.updatedAt).toBeTruthy();
    });

    it("GET /api/research/:companyId — retrieves workspace", async () => {
      const res = await fetch(`${baseUrl}/api/research/${companyId}`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.sector).toBe("FMCG");
    });

    it("GET /api/research — lists all workspace entries", async () => {
      const res = await fetch(`${baseUrl}/api/research`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
    });

    it("PUT /api/research/:companyId — merges with existing data", async () => {
      const res = await fetch(`${baseUrl}/api/research/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newField: "added" }),
      });
      const body = await res.json();
      expect(body.data.sector).toBe("FMCG"); // preserved from first PUT
      expect(body.data.newField).toBe("added");
    });

    it("DELETE /api/research/:companyId — removes workspace", async () => {
      const res = await fetch(`${baseUrl}/api/research/${companyId}`, { method: "DELETE" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);

      // Confirm it's gone
      const getRes = await fetch(`${baseUrl}/api/research/${companyId}`);
      expect(getRes.status).toBe(404);
    });

    it("rejects path traversal in companyId", async () => {
      const res = await fetch(`${baseUrl}/api/research/../../../etc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 1 }),
      });
      // Express normalizes the URL, so this becomes /api/etc which won't match
      // the :companyId route — or if it does, isSafeSegment blocks it
      expect(res.status === 400 || res.status === 404).toBe(true);
    });
  });

  describe("Blackboard API", () => {
    it("GET /api/blackboard — returns empty for new session", async () => {
      const res = await fetch(`${baseUrl}/api/blackboard?session=test-sess`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({});
    });

    it("PUT /api/blackboard — stores data", async () => {
      const res = await fetch(`${baseUrl}/api/blackboard?session=test-sess`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key1: "value1", key2: 42 }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("GET /api/blackboard — reads stored data back", async () => {
      const res = await fetch(`${baseUrl}/api/blackboard?session=test-sess`);
      const body = await res.json();
      expect(body.data.key1).toBe("value1");
      expect(body.data.key2).toBe(42);
    });
  });
});
