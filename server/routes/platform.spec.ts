import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisPlatformServiceV1 } from "../../src/platform";
import type { GovernanceEvidenceService } from "../../src/platform";
import { createPlatformRouter } from "./platform";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

describe("production platform HTTP router", () => {
  it("parses JSON itself and derives tenancy only from a verified session", async () => {
    const createRun = vi.fn(async (_context, body) => ({ run: { runId: body.runId }, replayed: false }));
    const service = { createRun } as unknown as AnalysisPlatformServiceV1;
    const sessions = { verifyBearerToken: vi.fn(async () => ({ principalId: "principal-1", userId: "user-1", organizationId: "org-signed" })) };
    const app = express();
    app.use(createPlatformRouter({ service, sessions }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
    const response = await fetch(`http://127.0.0.1:${address.port}/runs`, {
      method: "POST",
      headers: { authorization: "Bearer signed-token", "x-workspace-id": "workspace-1", "x-correlation-id": "corr-1", "idempotency-key": "idem-1", "content-type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    expect(response.status).toBe(201);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ scope: { organizationId: "org-signed", workspaceId: "workspace-1" } }), { runId: "run-1" }, expect.objectContaining({ correlationId: "corr-1", idempotencyKey: "idem-1" }));
  });

  it("resolves advanced-model attestations through the verified workspace boundary", async () => {
    const resolveAdvancedModels = vi.fn(async (_context, requests) => requests.map((request: { modelId: string }) => ({ request, dossierHash: `sha256:${"a".repeat(64)}` })));
    const governance = { resolveAdvancedModels } as unknown as GovernanceEvidenceService;
    const sessions = { verifyBearerToken: vi.fn(async () => ({ principalId: "principal-1", userId: "user-1", organizationId: "org-signed" })) };
    const app = express();
    app.use(createPlatformRouter({ service: {} as AnalysisPlatformServiceV1, governance, sessions }));
    const server = createServer(app); servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
    const requests = [{ modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", sidecarId: "options-1" }];
    const response = await fetch(`http://127.0.0.1:${address.port}/governance/advanced-models/resolve`, {
      method: "POST",
      headers: { authorization: "Bearer signed-token", "x-workspace-id": "workspace-1", "content-type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    expect(response.status).toBe(200);
    expect(resolveAdvancedModels).toHaveBeenCalledWith(expect.objectContaining({ scope: { organizationId: "org-signed", workspaceId: "workspace-1" } }), requests);
  });
});
