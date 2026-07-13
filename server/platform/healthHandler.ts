import crypto from "node:crypto";
import type { Request, Response } from "express";
import { buildPlatformActivationPreflight } from "../../src/platform/operations/activationPreflight";

function safeEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildPlatformConfigurationHealth(env: NodeJS.ProcessEnv = process.env) {
  const preflight = buildPlatformActivationPreflight(env, "release");
  return {
    schemaVersion: preflight.schemaVersion,
    status: preflight.status === "ready" ? "configured" as const : "blocked" as const,
    checks: preflight.checks,
    missingVariables: preflight.missingVariables,
    invalidVariables: preflight.invalidVariables,
  };
}

/** Token-authenticated deployment health probe used by the consolidated platform function. */
export default async function platformHealthHandler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  const requiredToken = process.env.PLATFORM_HEALTH_TOKEN;
  const presented = String(request.headers?.["x-platform-health-token"] ?? "");
  if ((process.env.NODE_ENV === "production" || requiredToken) && (!requiredToken || !safeEqual(presented, requiredToken))) {
    response.status(401).json({ error: "Unauthorized platform health access." });
    return;
  }
  const health = buildPlatformConfigurationHealth();
  const checkedAt = new Date().toISOString();
  if (health.status !== "configured") {
    response.status(503).json({ ok: false, ...health, checkedAt });
    return;
  }
  try {
    const [{ createPlatformRuntime }, { ProductionPlatformProbe }] = await Promise.all([
      import("./defaultRuntime"),
      import("../../src/platform/operations/productionProbe"),
    ]);
    const adapters = createPlatformRuntime();
    const live = await new ProductionPlatformProbe(adapters.sql, adapters.objects).run({
      organizationId: process.env.PLATFORM_HEALTH_ORGANIZATION_ID!,
      workspaceId: process.env.PLATFORM_HEALTH_WORKSPACE_ID!,
      probeId: `health-${Date.now()}`,
      checkedAt,
    });
    response.status(live.status === "ready" ? 200 : 503).json({ ok: live.status === "ready", checks: health.checks, ...live });
  } catch (error) {
    console.error("Platform live health probe failed", error instanceof Error ? error.name : "UnknownError");
    response.status(503).json({ ok: false, status: "blocked", checks: health.checks, checkedAt, error: "PLATFORM_LIVE_PROBE_FAILED" });
  }
}
