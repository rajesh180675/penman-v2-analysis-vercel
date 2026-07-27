import type { Request, Response } from "express";
import { createPlatformRuntime } from "../../server/platform/defaultRuntime";
import { cronAuthorizationMatches, runScheduledBackups } from "../../server/platform/scheduledOperations";

// Express request/response types, matching `api/platform/[...path].ts` and
// `server/platform/vercelHandler.ts`. @vercel/node is not a dependency here, and
// these handlers only touch method/headers/setHeader/status/json — all of which
// express types cover — so the repo's existing convention beats a new dependency.
export default async function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).json({ error: "Method not allowed." }); return; }
  if (!cronAuthorizationMatches(request.headers?.authorization, process.env.CRON_SECRET)) { response.status(401).json({ error: "Unauthorized." }); return; }
  try {
    const adapters = createPlatformRuntime();
    const results = await runScheduledBackups({ ...adapters, now: new Date().toISOString(), limit: Number(process.env.PLATFORM_SCHEDULED_WORKSPACE_LIMIT ?? 25) });
    response.status(200).json({ ok: true, backedUp: results.length, results });
  } catch (error) {
    console.error("Scheduled platform backup failed", error instanceof Error ? error.name : "UnknownError");
    response.status(503).json({ ok: false, error: "PLATFORM_BACKUP_UNAVAILABLE" });
  }
}
