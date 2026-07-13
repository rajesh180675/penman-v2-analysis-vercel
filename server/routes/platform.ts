import express from "express";
import type { AnalysisPlatformServiceV1, OperationStamp } from "../../src/platform/analysisPlatformService";
import type { ContentRef } from "../../src/engine/analysisRun";
import { createVerifiedWorkspaceMiddleware, requireVerifiedWorkspaceContext, type VerifiedSessionVerifier } from "../platform/sessionVerifier";
import type { GovernanceEvidenceService } from "../../src/platform/governanceEvidence";
import type { WorkspaceMembershipAdministrationService } from "../../src/platform/security";
import type { ProductionPlatformProbe } from "../../src/platform/operations";

function header(request: express.Request, name: string): string {
  const value = request.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function routeParam(request: express.Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0]! : value!;
}

function stamp(request: express.Request, suffix: string): OperationStamp {
  const correlationId = header(request, "x-correlation-id");
  const idempotencyKey = header(request, "idempotency-key");
  return {
    correlationId,
    idempotencyKey,
    eventId: request.headers["x-event-id"]?.toString() ?? `${correlationId}:${suffix}`,
    occurredAt: request.headers["x-occurred-at"]?.toString() ?? new Date().toISOString(),
  };
}

function asyncRoute(handler: (request: express.Request, response: express.Response) => Promise<void>) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => { void handler(request, response).catch(next); };
}

/** Authenticated HTTP adapter for the versioned platform application service. */
export function createPlatformRouter(input: { readonly service: AnalysisPlatformServiceV1; readonly governance?: GovernanceEvidenceService; readonly membershipAdmin?: WorkspaceMembershipAdministrationService; readonly probe?: ProductionPlatformProbe; readonly sessions: VerifiedSessionVerifier }) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb", type: ["application/json", "application/*+json"] }));
  router.use(createVerifiedWorkspaceMiddleware(input.sessions));
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  if (input.probe) router.get("/health", asyncRoute(async (_request, response) => {
    const context = requireVerifiedWorkspaceContext(response);
    const health = await input.probe!.run({ organizationId: context.scope.organizationId, workspaceId: context.scope.workspaceId, probeId: `http-${Date.now()}`, checkedAt: new Date().toISOString() });
    response.status(health.status === "ready" ? 200 : 503).json({ ok: health.status === "ready", ...health });
  }));

  router.get("/runs", asyncRoute(async (request, response) => {
    const statuses = typeof request.query.status === "string" ? request.query.status.split(",").filter(Boolean) : undefined;
    const page = await input.service.listRuns(requireVerifiedWorkspaceContext(response), {
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      cursor: typeof request.query.cursor === "string" ? request.query.cursor : undefined,
      issuerId: typeof request.query.issuerId === "string" ? request.query.issuerId : undefined,
      statuses: statuses as never,
      lifecycle: typeof request.query.lifecycle === "string" ? request.query.lifecycle as "open" | "finalized" : undefined,
    });
    response.status(200).json({ ok: true, ...page });
  }));

  router.post("/runs", asyncRoute(async (request, response) => {
    const created = await input.service.createRun(requireVerifiedWorkspaceContext(response), request.body, stamp(request, "created"));
    response.status(201).json({ ok: true, ...created });
  }));

  router.get("/runs/:runId", asyncRoute(async (request, response) => {
    const run = await input.service.getRun(requireVerifiedWorkspaceContext(response), routeParam(request, "runId"));
    if (!run) { response.status(404).json({ ok: false, error: "RUN_NOT_FOUND" }); return; }
    response.status(200).json({ ok: true, ...run });
  }));

  router.get("/runs/:runId/events", asyncRoute(async (request, response) => {
    const events = await input.service.listRunEvents(requireVerifiedWorkspaceContext(response), routeParam(request, "runId"), {
      afterSequence: request.query.after ? Number(request.query.after) : undefined,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    });
    response.status(200).json({ ok: true, events });
  }));

  router.post("/runs/:runId/finalize", asyncRoute(async (request, response) => {
    const result = await input.service.finalizeRun(requireVerifiedWorkspaceContext(response), routeParam(request, "runId"), Number(request.body?.expectedRevision), stamp(request, "finalized"));
    response.status(200).json({ ok: true, ...result });
  }));

  router.post("/runs/:runId/lock", asyncRoute(async (request, response) => {
    const lock = await input.service.lockRun(requireVerifiedWorkspaceContext(response), {
      runId: routeParam(request, "runId"), expectedRevision: Number(request.body?.expectedRevision),
      lockId: request.body?.lockId, reason: request.body?.reason, stamp: stamp(request, "locked"),
    });
    response.status(201).json({ ok: true, lock });
  }));

  router.put("/artifacts", express.raw({ type: "application/octet-stream", limit: "25mb" }), asyncRoute(async (request, response) => {
    if (!(request.body instanceof Buffer)) throw new Error("Artifact body must be application/octet-stream.");
    const ref = await input.service.putArtifact(requireVerifiedWorkspaceContext(response), new Uint8Array(request.body), {
      kind: header(request, "x-artifact-kind") as never,
      schemaVersion: header(request, "x-artifact-schema-version"), mediaType: header(request, "x-artifact-media-type"),
      contentClass: header(request, "x-content-class"), createdAt: header(request, "x-created-at"),
      issuerId: request.headers["x-issuer-id"]?.toString() ?? null,
      retentionUntil: request.headers["x-retention-until"]?.toString() ?? null,
    });
    response.status(201).json({ ok: true, ref });
  }));

  router.post("/artifacts/read", asyncRoute(async (request, response) => {
    const artifact = await input.service.getArtifact(requireVerifiedWorkspaceContext(response), request.body?.ref as ContentRef);
    if (!artifact) { response.status(404).json({ ok: false, error: "ARTIFACT_NOT_FOUND" }); return; }
    response.setHeader("Content-Type", artifact.metadata.mediaType);
    response.setHeader("x-content-hash", artifact.ref.contentHash);
    response.status(200).send(Buffer.from(artifact.bytes));
  }));

  if (input.governance) {
    router.post("/governance/scenario-observations", asyncRoute(async (request, response) => {
      const status = await input.governance!.ingestScenarioObservation(requireVerifiedWorkspaceContext(response), request.body);
      response.status(status === "created" ? 201 : 200).json({ ok: true, status });
    }));
    router.post("/governance/calibrations", asyncRoute(async (request, response) => {
      response.status(201).json({ ok: true, ...await input.governance!.calibrate(requireVerifiedWorkspaceContext(response), request.body?.policy) });
    }));
    router.post("/governance/scenario-input", asyncRoute(async (request, response) => {
      response.status(200).json({ ok: true, ...await input.governance!.scenarioInput(requireVerifiedWorkspaceContext(response), request.body?.policy) });
    }));
    router.post("/governance/sector-sidecars", asyncRoute(async (request, response) => {
      const status = await input.governance!.submitSectorSidecar(requireVerifiedWorkspaceContext(response), request.body);
      response.status(status === "created" ? 201 : 200).json({ ok: true, status });
    }));
    router.get("/governance/sector-sidecars", asyncRoute(async (request, response) => {
      const items = await input.governance!.listSectorSidecars(requireVerifiedWorkspaceContext(response), typeof request.query.issuerId === "string" ? request.query.issuerId : undefined);
      response.status(200).json({ ok: true, items });
    }));
    router.post("/governance/sector-onboarding", asyncRoute(async (request, response) => {
      const manifest = await input.governance!.onboardingManifest(requireVerifiedWorkspaceContext(response), request.body?.companies, request.body?.evaluationAt);
      response.status(200).json({ ok: true, manifest });
    }));
    router.post("/governance/model-promotions", asyncRoute(async (request, response) => {
      response.status(201).json({ ok: true, ...await input.governance!.submitPromotion(requireVerifiedWorkspaceContext(response), request.body?.dossier, request.body?.submittedAt) });
    }));
    router.post("/governance/model-promotions/reviews", asyncRoute(async (request, response) => {
      const status = await input.governance!.reviewPromotion(requireVerifiedWorkspaceContext(response), request.body);
      response.status(status === "created" ? 201 : 200).json({ ok: true, status });
    }));
    router.post("/governance/model-promotions/:modelId/evaluate", asyncRoute(async (request, response) => {
      response.status(200).json({ ok: true, ...await input.governance!.evaluateLatestPromotion(requireVerifiedWorkspaceContext(response), routeParam(request, "modelId")) });
    }));
    router.get("/governance/model-promotions/:modelId", asyncRoute(async (request, response) => {
      const items = await input.governance!.listPromotionDossiers(requireVerifiedWorkspaceContext(response), routeParam(request, "modelId"));
      response.status(200).json({ ok: true, items });
    }));
    router.post("/governance/real-options-compositions", asyncRoute(async (request, response) => {
      response.status(201).json({ ok: true, ...await input.governance!.submitComposition(requireVerifiedWorkspaceContext(response), request.body?.dossier, request.body?.submittedAt) });
    }));
    router.post("/governance/real-options-compositions/reviews", asyncRoute(async (request, response) => {
      const status = await input.governance!.reviewComposition(requireVerifiedWorkspaceContext(response), request.body);
      response.status(status === "created" ? 201 : 200).json({ ok: true, status });
    }));
    router.get("/governance/real-options-compositions/:issuerId", asyncRoute(async (request, response) => {
      const sidecarId = typeof request.query.sidecarId === "string" ? request.query.sidecarId : undefined;
      const items = await input.governance!.listCompositionDossiers(requireVerifiedWorkspaceContext(response), routeParam(request, "issuerId"), sidecarId);
      response.status(200).json({ ok: true, items });
    }));
    router.post("/governance/real-options-compositions/:issuerId/evaluate", asyncRoute(async (request, response) => {
      response.status(200).json({ ok: true, ...await input.governance!.evaluateLatestComposition(requireVerifiedWorkspaceContext(response), routeParam(request, "issuerId"), request.body?.sidecarId) });
    }));
    router.post("/governance/advanced-models/resolve", asyncRoute(async (request, response) => {
      const items = await input.governance!.resolveAdvancedModels(requireVerifiedWorkspaceContext(response), request.body?.requests);
      response.status(200).json({ ok: true, items });
    }));
  }

  if (input.membershipAdmin) router.put("/workspace/memberships/:principalId", asyncRoute(async (request, response) => {
    const occurredAt = request.body?.occurredAt ?? new Date().toISOString();
    const membership = await input.membershipAdmin!.write(requireVerifiedWorkspaceContext(response), {
      principalId: routeParam(request, "principalId"), roles: request.body?.roles, status: request.body?.status,
      validFrom: request.body?.validFrom, validUntil: request.body?.validUntil ?? null,
      eventId: request.body?.eventId ?? `${routeParam(request, "principalId")}:${Date.parse(occurredAt)}`,
      occurredAt,
    });
    response.status(200).json({ ok: true, membership });
  }));

  router.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "PLATFORM_REQUEST_FAILED";
    const reportedStatus = error && typeof error === "object" && "status" in error ? Number(error.status) : Number.NaN;
    const status = Number.isInteger(reportedStatus) && reportedStatus >= 400 && reportedStatus < 500 ? reportedStatus
      : code.includes("PERMISSION") || code.includes("MEMBERSHIP") ? 403
      : code.includes("NOT_FOUND") ? 404
        : code.includes("CONFLICT") || code.includes("ALREADY") || code.includes("IDEMPOTENCY") ? 409
          : code.includes("RATE_LIMIT") ? 429
            : code.includes("INVALID") || code.includes("REQUIRED") || code.includes("MISMATCH") ? 400 : 500;
    response.status(status).json({ ok: false, error: code });
  });

  return router;
}
